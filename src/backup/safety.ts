/**
 * Safety copies: the file written before a restore changes anything.
 *
 * Two rules hold this module together:
 *
 * 1. **Never overwrite.** Each copy gets a fresh, timestamped name. A new copy
 *    failing can therefore never destroy the previous one, which is the copy you
 *    would want if the app misbehaved earlier.
 * 2. **Write, then verify.** A copy is only reported as usable once it has been
 *    read back from disk, parsed, and compared item-for-item with what was in
 *    memory. A copy that does not read back is deleted, so it cannot be mistaken
 *    for a good one later.
 *
 * Copies live in the app's private document directory. `saveCopyToFolder` exists
 * so a copy can be moved somewhere the user can reach without adding another
 * native dependency.
 */
import { Directory, File, Paths } from 'expo-file-system';

import type { Item } from '@/types';

import { saveFileToFolder } from './files';
import {
  buildSafetyCopy,
  canonicalItems,
  safetyFileName,
  SAFETY_FORMAT,
  type SafetyCopy,
} from './format';

/** How many copies to keep. Pruning only ever runs after a successful restore. */
export const SAFETY_COPIES_TO_KEEP = 5;

const SAFETY_DIR_NAME = 'cuegoblin-safety';
const SAFETY_PREFIX = 'cuegoblin-safety-';

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

function safetyDirectory(): Directory {
  return new Directory(Paths.document, SAFETY_DIR_NAME);
}

async function ensureSafetyDirectory(): Promise<Directory> {
  const directory = safetyDirectory();
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  return directory;
}

export type SafetyWriteResult =
  | { ok: true; name: string; uri: string }
  | { ok: false; message: string };

/**
 * Writes a safety copy and proves it can be read back.
 *
 * Returning `ok: false` means: nothing about the current data or reminders has
 * been changed, and the caller must abort. A partially written file is removed.
 */
export async function writeVerifiedSafetyCopy(options: {
  items: Item[];
  scheduledReminderIds: string[];
  now?: number;
}): Promise<SafetyWriteResult> {
  const { items, scheduledReminderIds, now = Date.now() } = options;

  let file: File;
  try {
    const directory = await ensureSafetyDirectory();

    // `create()` refuses to overwrite, so a retry with a different suffix is how
    // two copies in the same second stay separate.
    file = new File(directory, safetyFileName(now));
    let attempts = 0;
    while (file.exists) {
      attempts += 1;
      if (attempts > 20) {
        return {
          ok: false,
          message: 'Could not find an unused name for the safety copy.',
        };
      }
      file = new File(directory, safetyFileName(now, String(attempts + 1)));
    }

    const copy: SafetyCopy = buildSafetyCopy({ items, scheduledReminderIds, now });
    file.create({ intermediates: true });
    await file.write(`${JSON.stringify(copy, null, 2)}\n`);
  } catch (error) {
    return {
      ok: false,
      message: `Could not write the safety copy: ${describeError(error)}`,
    };
  }

  const fail = (reason: string): SafetyWriteResult => {
    try {
      file.delete();
    } catch {
      // If it cannot be deleted it is still not going to be offered as valid.
    }
    return { ok: false, message: `The safety copy could not be verified: ${reason}` };
  };

  try {
    if (!file.exists) return fail('the file is not there after writing it.');

    const size = file.size;
    if (typeof size !== 'number' || size <= 0) {
      return fail('the file is empty.');
    }

    const raw = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail('the file could not be read back as JSON.');
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return fail('the file did not contain a safety copy.');
    }

    const candidate = parsed as Partial<SafetyCopy>;

    if (candidate.format !== SAFETY_FORMAT) {
      return fail('the file was written with the wrong format marker.');
    }

    if (!Array.isArray(candidate.items)) {
      return fail('the file has no item list.');
    }

    if (candidate.itemCount !== items.length || candidate.items.length !== items.length) {
      return fail(
        `the file holds ${candidate.items.length} items but ${items.length} were being protected.`,
      );
    }

    if (canonicalItems(candidate.items as Item[]) !== canonicalItems(items)) {
      return fail('the items read back do not match the items on this phone.');
    }
  } catch (error) {
    return fail(describeError(error));
  }

  return { ok: true, name: file.name, uri: file.uri };
}

export type SafetyCopyEntry = {
  name: string;
  uri: string;
  size: number;
  file: File;
};

/** Newest first. Names are timestamp-prefixed, so they sort chronologically. */
export async function listSafetyCopies(): Promise<SafetyCopyEntry[]> {
  const directory = safetyDirectory();
  if (!directory.exists) return [];

  let entries: (File | Directory)[];
  try {
    entries = directory.list();
  } catch (error) {
    console.warn('[CueGoblin backup] Could not list safety copies', error);
    return [];
  }

  return entries
    .filter((entry): entry is File => entry instanceof File)
    .filter((file) => file.name.startsWith(SAFETY_PREFIX) && file.name.endsWith('.json'))
    .map((file) => ({ name: file.name, uri: file.uri, size: file.size ?? 0, file }))
    .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

/**
 * Deletes all but the newest `keep` copies.
 *
 * Only called after a restore has written its data, so an aborted restore leaves
 * every copy in place. Failures are collected rather than thrown: housekeeping
 * must not turn a good restore into a failed one.
 */
export async function pruneSafetyCopies(
  keep: number = SAFETY_COPIES_TO_KEEP,
): Promise<{ deleted: string[]; failed: { name: string; message: string }[] }> {
  const copies = await listSafetyCopies();
  const stale = copies.slice(Math.max(keep, 0));

  const deleted: string[] = [];
  const failed: { name: string; message: string }[] = [];

  for (const copy of stale) {
    try {
      copy.file.delete();
      deleted.push(copy.name);
    } catch (error) {
      failed.push({ name: copy.name, message: describeError(error) });
    }
  }

  return { deleted, failed };
}

export async function saveCopyToFolder(
  name: string,
): Promise<{ ok: true; fileName: string } | { ok: false; canceled: boolean; message: string }> {
  const copies = await listSafetyCopies();
  const match = copies.find((copy) => copy.name === name);

  if (!match) {
    return {
      ok: false,
      canceled: false,
      message: 'That safety copy is no longer on this phone.',
    };
  }

  return saveFileToFolder(match.file);
}
