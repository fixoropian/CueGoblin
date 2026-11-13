/**
 * The only file that knows where items are saved.
 *
 * Right now that is AsyncStorage: one JSON array under one key. That is more
 * than enough for a personal list and keeps the code readable. Everything here
 * is async because storage is, and because swapping in SQLite later should touch
 * this file only — screens and the store never import AsyncStorage directly.
 *
 * The rule that matters most in this file: a failed read must NEVER look like an
 * empty list. If we returned `[]` on error, the app would think you have no
 * items, then save that empty list back over your real data. So read and write
 * both report success or failure explicitly, and the store decides what the
 * user sees.
 *
 * Note: AsyncStorage is app-private but NOT encrypted. Fine for notes and
 * shopping lists; not a place for passwords.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { isItem, type Item } from '@/types';

/**
 * The ".v1" suffix is deliberate. If the saved shape ever changes, a new key can
 * be introduced and the old one read once to migrate — no silent data loss.
 */
const STORAGE_KEY = 'cuegoblin.items.v1';

/** Either we read the list successfully, or we know exactly why we could not. */
export type LoadResult =
  | { ok: true; items: Item[] }
  | { ok: false; message: string };

/** The same idea for writing. */
export type SaveResult = { ok: true } | { ok: false; message: string };

/**
 * Reads the saved list.
 *
 * `ok: false` covers every situation where we cannot be sure what is on disk:
 * the read itself failed, the stored text is not valid JSON, it is not a list,
 * or it contains records we do not recognise. In all of those cases the caller
 * must not treat the list as empty.
 */
export async function loadItems(): Promise<LoadResult> {
  let raw: string | null;

  try {
    raw = await AsyncStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn('[storage] Could not read saved items', error);
    return {
      ok: false,
      message: 'Could not read your saved items from this device.',
    };
  }

  // No key yet means a brand new install. That is a genuine empty list, not
  // an error.
  if (raw === null) {
    return { ok: true, items: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn('[storage] Saved items are not valid JSON', error);
    return {
      ok: false,
      message: 'Your saved items could not be read. They have been left untouched.',
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      message: 'Your saved items were in an unexpected format. They have been left untouched.',
    };
  }

  // Dropping unreadable records and saving the rest would delete them. Report
  // the problem instead and let the user retry.
  const invalid = parsed.filter((entry) => !isItem(entry)).length;
  if (invalid > 0) {
    return {
      ok: false,
      message: `${invalid} saved item${invalid === 1 ? '' : 's'} could not be read. They have been left untouched.`,
    };
  }

  return { ok: true, items: parsed };
}

/**
 * Writes the whole list.
 *
 * The list is small, so rewriting it in one go is simpler and safer than
 * tracking individual keys. A failed write is reported to the caller so the UI
 * can tell you your change did not stick — and the in-memory list is left
 * alone so nothing is silently discarded.
 */
export async function saveItems(items: Item[]): Promise<SaveResult> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    return { ok: true };
  } catch (error) {
    console.warn('[storage] Could not save items', error);
    return {
      ok: false,
      message: 'Could not save your changes to this device.',
    };
  }
}
