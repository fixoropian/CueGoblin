/**
 * The only file that knows where items are saved.
 *
 * Right now that is AsyncStorage: one JSON array under one key. That is more
 * than enough for a personal list and keeps the code readable. Everything here
 * is async because storage is, and because swapping in SQLite later should touch
 * this file only — screens and the store never import AsyncStorage directly.
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

export async function loadItems(): Promise<Item[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Keep only well-formed records so one bad entry cannot break the list.
    return parsed.filter(isItem);
  } catch (error) {
    // Never throw here: a broken read should still let the app open and capture.
    console.warn('[storage] Could not read saved items', error);
    return [];
  }
}

export async function saveItems(items: Item[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (error) {
    // A failed write is logged rather than surfaced as a dialog; the in-memory
    // list stays usable and the next change tries again.
    console.warn('[storage] Could not save items', error);
  }
}
