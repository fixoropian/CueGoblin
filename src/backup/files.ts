/**
 * The only backup file that touches the file system.
 *
 * Export, restore-picking and saving a safety copy out all go through here, so
 * the screens keep dealing in `Item[]` and results rather than in URIs. Same
 * rule as `src/storage/items.ts`: one module owns the platform detail.
 *
 * Both pickers are the system's own (Storage Access Framework on Android), so
 * CueGoblin never asks for broad storage permission. A cancelled pick is a
 * normal outcome, not an error: the file system throws for a cancelled folder
 * pick and returns `canceled` for a cancelled file pick, and both are reported
 * as `canceled` here.
 */
import { Directory, File } from 'expo-file-system';

import type { Item } from '@/types';

import {
  buildBackup,
  backupFileName,
  MAX_BACKUP_BYTES,
  parseBackup,
  type Backup,
  type Parsed,
} from './format';

const BACKUP_MIME_TYPE = 'application/json';

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

/** Removes a file that could not be verified. A leftover half-written file is
 * harmless, but a missing one can never be mistaken for a good backup. */
function discard(file: File): void {
  try {
    file.delete();
  } catch {
    // Best effort only.
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** The folder picker has no `canceled` result; it throws instead. */
export function isPickerCancelled(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /cancel/i.test(error.message);
}

export type FolderPick =
  | { ok: true; directory: Directory }
  | { ok: false; canceled: boolean; message: string };

export async function pickFolder(): Promise<FolderPick> {
  try {
    const directory = await Directory.pickDirectoryAsync();
    return { ok: true, directory };
  } catch (error) {
    if (isPickerCancelled(error)) {
      return { ok: false, canceled: true, message: 'No folder was chosen, so nothing was written.' };
    }
    return {
      ok: false,
      canceled: false,
      message: `The folder picker could not be opened: ${describeError(error)}`,
    };
  }
}

export type ExportResult =
  | { ok: true; fileName: string; uri: string }
  | { ok: false; canceled: boolean; message: string };

/**
 * Writes every item to a file in a folder the user picks, then checks it landed.
 *
 * The picked folder is a SAF `content://` URI on Android, where a `File` built
 * under the directory cannot create the document itself — Expo rejects that and
 * points at `Directory.createFile`. So the picked directory creates the file and
 * we write through the `File` it returns. That also means the name reported back
 * is the one the storage provider actually used, in case it renamed a collision.
 *
 * The export is only reported as a success once the text read back matches what
 * was written.
 */
export async function exportBackup(items: Item[], now: number = Date.now()): Promise<ExportResult> {
  const folder = await pickFolder();
  if (!folder.ok) return folder;

  const payload = `${JSON.stringify(buildBackup(items, now), null, 2)}\n`;

  let file: File;
  try {
    file = folder.directory.createFile(backupFileName(now), BACKUP_MIME_TYPE);
  } catch (error) {
    return {
      ok: false,
      canceled: false,
      message: `Could not create the backup file in that folder: ${describeError(error)}`,
    };
  }

  try {
    await file.write(payload);
  } catch (error) {
    discard(file);
    return {
      ok: false,
      canceled: false,
      message: `Could not write the backup file: ${describeError(error)}`,
    };
  }

  let written: string;
  try {
    written = await file.text();
  } catch (error) {
    discard(file);
    return {
      ok: false,
      canceled: false,
      message: `The backup file was written but could not be read back, so the export was not confirmed: ${describeError(error)}`,
    };
  }

  if (written !== payload) {
    discard(file);
    return {
      ok: false,
      canceled: false,
      message: 'The backup file was written but does not read back as the same contents, so the export was not confirmed.',
    };
  }

  return { ok: true, fileName: file.name, uri: file.uri };
}

export type PickedBackup =
  | { status: 'picked'; file: File; name: string }
  | { status: 'canceled' }
  | { status: 'failed'; message: string };

export async function pickBackupFile(): Promise<PickedBackup> {
  // Not filtered to JSON: several Android providers report a .json file as
  // application/octet-stream, which would hide the user's own backup from them.
  // Validation rejects anything that is not a CueGoblin backup.
  const picked = await File.pickFileAsync({ mimeTypes: ['*/*'] });

  if (picked.canceled || !picked.result) return { status: 'canceled' };

  const file = picked.result;
  return { status: 'picked', file, name: file.name };
}

/**
 * Reads and validates a chosen file. Size is checked from the file metadata
 * before the contents are pulled into memory, then again in `parseBackup` for
 * text that arrives by another route.
 */
export async function readBackupFile(file: File): Promise<Parsed<Backup>> {
  const size = file.size;
  if (typeof size === 'number' && size > MAX_BACKUP_BYTES) {
    return { ok: false, message: 'This file is too large to be a CueGoblin backup.' };
  }

  let text: string;
  try {
    text = await file.text();
  } catch (error) {
    return { ok: false, message: `This file could not be read: ${describeError(error)}` };
  }

  return parseBackup(text);
}

/**
 * Copies an existing app-private file into a folder the user picks. Used to get
 * a safety copy off the device, and to save a backup out again.
 *
 * The same SAF rule as `exportBackup` applies: a `File` built under the picked
 * `content://` directory cannot create itself there, so the picked directory
 * creates the document and the bytes are written through the `File` it returns.
 * Only JSON lives in these files, so they are created as `application/json`.
 *
 * The copy is only reported as a success once the bytes read back match the
 * source; anything else is deleted rather than left looking like a good copy.
 */
export async function saveFileToFolder(
  source: File,
): Promise<{ ok: true; fileName: string } | { ok: false; canceled: boolean; message: string }> {
  const folder = await pickFolder();
  if (!folder.ok) return folder;

  let payload: Uint8Array;
  try {
    payload = await source.bytes();
  } catch (error) {
    return {
      ok: false,
      canceled: false,
      message: `Could not read ${source.name} from this phone: ${describeError(error)}`,
    };
  }

  let file: File;
  try {
    file = folder.directory.createFile(source.name, BACKUP_MIME_TYPE);
  } catch (error) {
    return {
      ok: false,
      canceled: false,
      message: `Could not create ${source.name} in that folder: ${describeError(error)}`,
    };
  }

  try {
    await file.write(payload);
  } catch (error) {
    discard(file);
    return {
      ok: false,
      canceled: false,
      message: `Could not save ${source.name} to that folder: ${describeError(error)}`,
    };
  }

  let written: Uint8Array;
  try {
    written = await file.bytes();
  } catch (error) {
    discard(file);
    return {
      ok: false,
      canceled: false,
      message: `${source.name} was written but could not be read back, so the copy was not confirmed: ${describeError(error)}`,
    };
  }

  if (!sameBytes(written, payload)) {
    discard(file);
    return {
      ok: false,
      canceled: false,
      message: `${source.name} was written but does not read back as the same contents, so the copy was not confirmed.`,
    };
  }

  return { ok: true, fileName: file.name };
}
