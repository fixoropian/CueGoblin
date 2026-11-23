import { describe, expect, it } from 'vitest';

import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  buildBackup,
  buildSafetyCopy,
  canonicalItems,
  backupFileName,
  MAX_BACKUP_BYTES,
  parseBackup,
  safetyFileName,
} from '@/backup/format';
import type { Item } from '@/types';

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-1',
    text: 'Buy bread',
    kind: 'shopping',
    done: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function backupText(items: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: 1_700_000_000_000,
    items,
    ...extra,
  });
}

describe('parseBackup', () => {
  it('round-trips an exported backup', () => {
    const items = [item(), item({ id: 'item-2', text: 'Call Mum', reminderAt: 1_800_000_000_000 })];
    const parsed = parseBackup(JSON.stringify(buildBackup(items, 1_700_000_000_000)));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.items).toEqual(items);
    expect(parsed.value.exportedAt).toBe(1_700_000_000_000);
  });

  it('accepts items saved before reminders existed', () => {
    const parsed = parseBackup(backupText([item()]));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.items[0].reminderAt).toBeUndefined();
  });

  it('rejects an empty backup instead of treating it as "delete everything"', () => {
    const parsed = parseBackup(backupText([]));

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain('contains no items');
  });

  it('rejects text that is not JSON', () => {
    const parsed = parseBackup('not json at all');

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain('not valid JSON');
  });

  it('rejects an empty file', () => {
    const parsed = parseBackup('   ');

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain('empty');
  });

  it('rejects a file from a different app', () => {
    const parsed = parseBackup(backupText([item()], { format: 'something.else' }));

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain('not a CueGoblin backup');
  });

  it('rejects a backup made by a newer version', () => {
    const parsed = parseBackup(backupText([item()], { version: BACKUP_VERSION + 1 }));

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain('newer version');
  });

  it('rejects a whole file when one item is unreadable', () => {
    const parsed = parseBackup(backupText([item(), item({ id: 'item-2' }), { text: 'no id' }]));

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain('1 item');
  });

  it('rejects duplicate item IDs', () => {
    const parsed = parseBackup(backupText([item(), item()]));

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain('same item ID twice');
  });

  it('rejects a file larger than the size limit', () => {
    const parsed = parseBackup('x'.repeat(MAX_BACKUP_BYTES + 1));

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain('too large');
  });
});

describe('canonicalItems', () => {
  it('ignores field order and list order but not content', () => {
    const a = [item({ id: 'b' }), item({ id: 'a' })];
    const b = [item({ id: 'a' }), item({ id: 'b' })];

    expect(canonicalItems(a)).toBe(canonicalItems(b));
    expect(canonicalItems(a)).not.toBe(canonicalItems([item({ id: 'a', text: 'changed' })]));
  });

  it('treats a missing reminder as the same as a null reminder', () => {
    expect(canonicalItems([item()])).toBe(canonicalItems([item({ reminderAt: null })]));
  });
});

describe('file names', () => {
  it('timestamps an export and a safety copy', () => {
    const now = new Date(2026, 10, 23, 14, 10, 33).getTime();

    expect(backupFileName(now)).toBe('cuegoblin-backup-2026-11-23-141033.json');
    expect(safetyFileName(now)).toBe('cuegoblin-safety-2026-11-23-141033.json');
    expect(safetyFileName(now, '2')).toBe('cuegoblin-safety-2026-11-23-141033-2.json');
  });
});

describe('buildSafetyCopy', () => {
  it('records the item count and queued reminder identifiers', () => {
    const copy = buildSafetyCopy({
      items: [item()],
      scheduledReminderIds: ['cuegoblin-reminder-item-1'],
      now: 5,
    });

    expect(copy.itemCount).toBe(1);
    expect(copy.reason).toBe('before-restore');
    expect(copy.scheduledReminderIds).toEqual(['cuegoblin-reminder-item-1']);
  });
});
