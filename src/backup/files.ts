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

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
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
 * The file is only reported as exported when it exists and is not empty.
 */
export async function exportBackup(items: Item[], now: number = Date.now()): Promise<ExportResult> {
  const folder = await pickFolder();
  if (!folder.ok) return folder;

  const fileName = backupFileName(now);
  const file = new File(folder.directory, fileName);

  try {
    file.create({ intermediates: true });
    await file.write(`${JSON.stringify(buildBackup(items, now), null, 2)}\n`);
  } catch (error) {
    return {
      ok: false,
      canceled: false,
      message: `Could not write the backup file: ${describeError(error)}`,
    };
  }

  if (!file.exists || (file.size ?? 0) <= 0) {
    try {
      file.delete();
    } catch {
      // Best effort: a zero-byte file is harmless, just useless.
    }
    return {
      ok: false,
      canceled: false,
      message: 'The backup file was written but could not be read back, so the export was not confirmed.',
    };
  }

  return { ok: true, fileName, uri: file.uri };
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
 */
export async function saveFileToFolder(
  source: File,
): Promise<{ ok: true; fileName: string } | { ok: false; canceled: boolean; message: string }> {
  const folder = await pickFolder();
  if (!folder.ok) return folder;

  try {
    await source.copy(new File(folder.directory, source.name), { overwrite: false });
  } catch (error) {
    return {
      ok: false,
      canceled: false,
      message: `Could not save ${source.name} to that folder: ${describeError(error)}`,
    };
  }

  return { ok: true, fileName: source.name };
}
