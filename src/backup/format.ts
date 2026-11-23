/**
 * The shape of a backup file, and the only place that decides whether a file is
 * safe to restore.
 *
 * Everything here is pure: no file system, no notifications. The rules that
 * protect your data are therefore testable without a phone — all-or-nothing
 * validation, an exact format marker, a version check, and no duplicate IDs.
 *
 * A backup is deliberately small and boring: a format marker, a version, a
 * timestamp and the same `Item[]` that storage already holds. Nothing is
 * renamed or reshaped on the way out, so restoring a file is the inverse of
 * exporting it, and an older file stays readable as long as `isItem` accepts
 * its items.
 */
import { isItem, type Item } from '@/types';

export const BACKUP_FORMAT = 'cuegoblin.backup';
export const SAFETY_FORMAT = 'cuegoblin.safety';

/**
 * Bumped only when the envelope changes in a way older code cannot read.
 * A file from a newer version is refused rather than half-understood.
 */
export const BACKUP_VERSION = 1;

/** A personal list is kilobytes. Anything this big is not one of our files. */
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

export type Backup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  /** Epoch milliseconds, for the preview and for the file name. */
  exportedAt: number;
  items: Item[];
};

/**
 * The copy written before a restore changes anything. It records the scheduled
 * reminder identifiers too, so the file explains what the phone had queued at
 * that moment — it is a record, not something restore reads back.
 */
export type SafetyCopy = {
  format: typeof SAFETY_FORMAT;
  version: number;
  createdAt: number;
  reason: 'before-restore';
  itemCount: number;
  scheduledReminderIds: string[];
  items: Item[];
};

/** Either the value is fully usable, or we can say exactly why it is not. */
export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

function stamp(now: number): string {
  const date = new Date(now);
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

export function backupFileName(now: number = Date.now()): string {
  return `cuegoblin-backup-${stamp(now)}.json`;
}

/**
 * Safety copies are timestamped and never overwritten. The suffix keeps two
 * copies written in the same second apart.
 */
export function safetyFileName(now: number = Date.now(), suffix?: string): string {
  const tail = suffix ? `-${suffix}` : '';
  return `cuegoblin-safety-${stamp(now)}${tail}.json`;
}

/**
 * A stable string for comparing item lists. Field order and list order are
 * fixed here, so two lists are equal only when their contents are — this is
 * what the safety copy is verified against.
 */
export function canonicalItems(items: Item[]): string {
  return JSON.stringify(
    [...items]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((item) => ({
        id: item.id,
        text: item.text,
        kind: item.kind,
        done: item.done,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        reminderAt: item.reminderAt ?? null,
      })),
  );
}

export function buildBackup(items: Item[], now: number = Date.now()): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now,
    items,
  };
}

export function buildSafetyCopy(options: {
  items: Item[];
  scheduledReminderIds: string[];
  now?: number;
}): SafetyCopy {
  const { items, scheduledReminderIds, now = Date.now() } = options;
  return {
    format: SAFETY_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now,
    reason: 'before-restore',
    itemCount: items.length,
    scheduledReminderIds,
    items,
  };
}

/**
 * Reads an untrusted `items` array.
 *
 * All-or-nothing on purpose: dropping the records we cannot read and carrying
 * on would silently delete those items on restore. An empty list is allowed
 * here because a safety copy of an empty list is legitimate; whether an empty
 * *backup* may be restored is a separate product decision in `parseBackup`.
 */
export function parseItems(value: unknown): Parsed<Item[]> {
  if (!Array.isArray(value)) {
    return { ok: false, message: 'The "items" entry is not a list.' };
  }

  const invalid = value.filter((entry) => !isItem(entry)).length;
  if (invalid > 0) {
    return {
      ok: false,
      message: `${invalid} item${invalid === 1 ? '' : 's'} in this file could not be read, so nothing was restored.`,
    };
  }

  const seen = new Set<string>();
  for (const item of value as Item[]) {
    if (seen.has(item.id)) {
      return {
        ok: false,
        message: `This file contains the same item ID twice (${item.id}), so it cannot be restored safely.`,
      };
    }
    seen.add(item.id);
  }

  return { ok: true, value: value as Item[] };
}

/**
 * Parses a backup file.
 *
 * Every rejection names the reason, because the user chose this file and is
 * owed an explanation rather than a generic failure.
 */
export function parseBackup(raw: string): Parsed<Backup> {
  if (raw.length > MAX_BACKUP_BYTES) {
    return { ok: false, message: 'This file is too large to be a CueGoblin backup.' };
  }

  if (raw.trim().length === 0) {
    return { ok: false, message: 'This file is empty.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: 'This file is not valid JSON.' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: 'This file is not a CueGoblin backup.' };
  }

  const candidate = parsed as Record<string, unknown>;

  if (candidate.format !== BACKUP_FORMAT) {
    return {
      ok: false,
      message: 'This file is not a CueGoblin backup (the format marker is missing or different).',
    };
  }

  const version = candidate.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, message: 'This backup has an invalid version number.' };
  }

  if (version > BACKUP_VERSION) {
    return {
      ok: false,
      message: `This backup was made by a newer version of CueGoblin (file version ${version}, this app reads version ${BACKUP_VERSION}).`,
    };
  }

  const exportedAt = candidate.exportedAt;
  if (typeof exportedAt !== 'number' || !Number.isFinite(exportedAt) || exportedAt <= 0) {
    return { ok: false, message: 'This backup has no valid export date.' };
  }

  const items = parseItems(candidate.items);
  if (!items.ok) return { ok: false, message: items.message };

  if (items.value.length === 0) {
    return {
      ok: false,
      message: 'This backup contains no items, so there is nothing to restore.',
    };
  }

  return {
    ok: true,
    value: {
      format: BACKUP_FORMAT,
      version,
      exportedAt,
      items: items.value,
    },
  };
}
