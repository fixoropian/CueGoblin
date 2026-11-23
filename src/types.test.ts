import { describe, expect, it } from 'vitest';

import { isItem, type Item } from '@/types';

const legacyItem: Item = {
  id: 'saved-before-reminders',
  text: 'Existing saved item',
  kind: 'task',
  done: false,
  createdAt: 1,
  updatedAt: 2,
};

describe('Item reminder compatibility', () => {
  it('keeps items saved before reminders existed readable', () => {
    expect(isItem(legacyItem)).toBe(true);
  });

  it('accepts a valid local reminder timestamp', () => {
    expect(isItem({ ...legacyItem, reminderAt: 1_800_000_000_000 })).toBe(true);
  });

  it('rejects an invalid reminder without silently treating the item as empty', () => {
    expect(isItem({ ...legacyItem, reminderAt: 'tomorrow' })).toBe(false);
    expect(isItem({ ...legacyItem, reminderAt: Number.NaN })).toBe(false);
    expect(isItem({ ...legacyItem, reminderAt: -1 })).toBe(false);
  });
});
