import { describe, expect, it, vi } from 'vitest';

import { applyRestore, planRestore, type RestoreDeps } from '@/backup/restore';
import { buildBackup } from '@/backup/format';
import type { Item } from '@/types';

const NOW = 1_800_000_000_000;

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'old-1',
    text: 'Old item',
    kind: 'note',
    done: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

const current = [item({ id: 'old-1' }), item({ id: 'old-2', text: 'Second old item' })];

const incoming = [
  item({ id: 'new-1', text: 'Restored task', kind: 'task', reminderAt: NOW + 60_000 }),
  item({ id: 'new-2', text: 'Restored note', kind: 'note', reminderAt: NOW - 60_000 }),
  item({ id: 'old-1', text: 'Same id, new text' }),
];

const backup = buildBackup(incoming, NOW - 10_000);

function makeDeps(overrides: Partial<RestoreDeps> = {}): RestoreDeps {
  return {
    listScheduledReminderIds: vi.fn(async () => ['cuegoblin-reminder-old-1']),
    writeSafetyCopy: vi.fn(async () => ({ ok: true as const, name: 'cuegoblin-safety-x.json' })),
    replaceItems: vi.fn(async () => ({ ok: true as const })),
    readStoredItems: vi.fn(async () => ({ ok: true as const, items: current })),
    cancelReminder: vi.fn(async () => ({ ok: true as const })),
    scheduleReminder: vi.fn(async () => ({ ok: true as const })),
    pruneSafetyCopies: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('applyRestore: safety copy gate', () => {
  it('aborts before changing anything when the safety copy cannot be written', async () => {
    const deps = makeDeps({
      writeSafetyCopy: vi.fn(async () => ({
        ok: false as const,
        message: 'disk full',
      })),
    });

    const outcome = await applyRestore({ current, backup, deps, now: NOW });

    expect(outcome.status).toBe('not-restored');
    if (outcome.status === 'not-restored') expect(outcome.stage).toBe('copy');
    expect(deps.replaceItems).not.toHaveBeenCalled();
    expect(deps.cancelReminder).not.toHaveBeenCalled();
    expect(deps.scheduleReminder).not.toHaveBeenCalled();
    expect(deps.pruneSafetyCopies).not.toHaveBeenCalled();
  });

  it('aborts before writing a copy when the queued reminders cannot be read', async () => {
    const deps = makeDeps({
      listScheduledReminderIds: vi.fn(async () => {
        throw new Error('notifications unavailable');
      }),
    });

    const outcome = await applyRestore({ current, backup, deps, now: NOW });

    expect(outcome.status).toBe('not-restored');
    if (outcome.status === 'not-restored') {
      expect(outcome.stage).toBe('copy');
      expect(outcome.message).toContain('notifications unavailable');
    }
    expect(deps.writeSafetyCopy).not.toHaveBeenCalled();
    expect(deps.replaceItems).not.toHaveBeenCalled();
  });

  it('treats a thrown safety-copy error as an abort, not a crash', async () => {
    const deps = makeDeps({
      writeSafetyCopy: vi.fn(async () => {
        throw new Error('permission denied');
      }),
    });

    const outcome = await applyRestore({ current, backup, deps, now: NOW });

    expect(outcome.status).toBe('not-restored');
    expect(deps.replaceItems).not.toHaveBeenCalled();
  });

  it('hands the current items and queued reminders to the safety copy', async () => {
    const deps = makeDeps();

    await applyRestore({ current, backup, deps, now: NOW });

    expect(deps.writeSafetyCopy).toHaveBeenCalledWith(current, ['cuegoblin-reminder-old-1']);
  });
});

describe('applyRestore: storage failure', () => {
  it('reports storage as unchanged when a failed write left the old list in place', async () => {
    const deps = makeDeps({
      replaceItems: vi.fn(async () => ({ ok: false as const, message: 'write failed' })),
      readStoredItems: vi.fn(async () => ({ ok: true as const, items: current })),
    });

    const outcome = await applyRestore({ current, backup, deps, now: NOW });

    expect(outcome.status).toBe('not-restored');
    if (outcome.status === 'not-restored') {
      expect(outcome.stage).toBe('storage');
      expect(outcome.storedState).toBe('unchanged');
      expect(outcome.safetyCopyName).toBe('cuegoblin-safety-x.json');
    }
    expect(deps.cancelReminder).not.toHaveBeenCalled();
    expect(deps.scheduleReminder).not.toHaveBeenCalled();
    expect(deps.pruneSafetyCopies).not.toHaveBeenCalled();
  });

  it('reports storage as changed when a failed write still altered what is saved', async () => {
    const deps = makeDeps({
      replaceItems: vi.fn(async () => ({ ok: false as const, message: 'write failed' })),
      readStoredItems: vi.fn(async () => ({ ok: true as const, items: [incoming[0]] })),
    });

    const outcome = await applyRestore({ current, backup, deps, now: NOW });

    expect(outcome.status).toBe('not-restored');
    if (outcome.status === 'not-restored') expect(outcome.storedState).toBe('changed');
    expect(deps.cancelReminder).not.toHaveBeenCalled();
  });

  it('assumes the worst when storage cannot be re-read', async () => {
    const deps = makeDeps({
      replaceItems: vi.fn(async () => ({ ok: false as const, message: 'write failed' })),
      readStoredItems: vi.fn(async () => ({ ok: false as const, message: 'read failed' })),
    });

    const outcome = await applyRestore({ current, backup, deps, now: NOW });

    if (outcome.status === 'not-restored') expect(outcome.storedState).toBe('changed');
  });

  it('treats a thrown storage error as a failed write', async () => {
    const deps = makeDeps({
      replaceItems: vi.fn(async () => {
        throw new Error('boom');
      }),
    });

    const outcome = await applyRestore({ current, backup, deps, now: NOW });

    expect(outcome.status).toBe('not-restored');
    if (outcome.status === 'not-restored') expect(outcome.stage).toBe('storage');
  });
});

describe('applyRestore: success and reminders', () => {
  it('restores the data, clears old reminders and schedules only future ones', async () => {
    const deps = makeDeps();

    const outcome = await applyRestore({ current, backup, deps, now: NOW });

    expect(outcome.status).toBe('restored');
    if (outcome.status === 'restored') {
      expect(outcome.itemCount).toBe(3);
      expect(outcome.scheduledCount).toBe(1);
      expect(outcome.expiredCount).toBe(1);
      expect(outcome.safetyCopyName).toBe('cuegoblin-safety-x.json');
    }

    expect(deps.replaceItems).toHaveBeenCalledWith(incoming);
    expect(deps.pruneSafetyCopies).toHaveBeenCalledTimes(1);

    // Both the old and restored IDs are cleared, so an item that lost its
    // reminder cannot inherit a stale alert.
    const cancelled = vi.mocked(deps.cancelReminder).mock.calls.map(([id]) => id).sort();
    expect(cancelled).toEqual(['new-1', 'new-2', 'old-1', 'old-2']);

    const scheduled = vi.mocked(deps.scheduleReminder).mock.calls.map(([scheduledItem]) => scheduledItem.id);
    expect(scheduled).toEqual(['new-1']);
  });

  it('never reports success when a reminder could not be scheduled', async () => {
    const deps = makeDeps({
      scheduleReminder: vi.fn(async (scheduledItem: Item) =>
        scheduledItem.id === 'new-1'
          ? { ok: false as const, message: 'scheduling refused' }
          : { ok: true as const },
      ),
    });

    const outcome = await applyRestore({ current, backup, deps, now: NOW });

    expect(outcome.status).toBe('restored-with-problems');
    if (outcome.status === 'restored-with-problems') {
      expect(outcome.scheduleFailures).toEqual([
        { itemId: 'new-1', text: 'Restored task', message: 'scheduling refused' },
      ]);
      expect(outcome.cancelFailures).toEqual([]);
      expect(outcome.itemCount).toBe(3);
    }
  });

  it('never reports success when an old reminder could not be cancelled', async () => {
    const deps = makeDeps({
      cancelReminder: vi.fn(async (id: string) =>
        id === 'old-1' ? { ok: false as const, message: 'cancel refused' } : { ok: true as const },
      ),
    });

    const outcome = await applyRestore({ current, backup, deps, now: NOW });

    expect(outcome.status).toBe('restored-with-problems');
    if (outcome.status === 'restored-with-problems') {
      expect(outcome.cancelFailures).toEqual([
        { itemId: 'old-1', text: 'Same id, new text', message: 'cancel refused' },
      ]);
    }
  });

  it('keeps a thrown scheduling error as a per-item failure', async () => {
    const deps = makeDeps({
      scheduleReminder: vi.fn(async () => {
        throw new Error('native module missing');
      }),
    });

    const outcome = await applyRestore({ current, backup, deps, now: NOW });

    expect(outcome.status).toBe('restored-with-problems');
    if (outcome.status === 'restored-with-problems') {
      expect(outcome.scheduleFailures[0].message).toBe('native module missing');
    }
  });

  it('does not fail the restore when pruning old copies throws', async () => {
    const deps = makeDeps({
      pruneSafetyCopies: vi.fn(async () => {
        throw new Error('disk busy');
      }),
    });

    const outcome = await applyRestore({ current, backup, deps, now: NOW });

    expect(outcome.status).toBe('restored');
  });
});

describe('planRestore', () => {
  it('summarises what the restore would change', () => {
    const plan = planRestore(current, backup, NOW);

    expect(plan.incomingCount).toBe(3);
    expect(plan.currentCount).toBe(2);
    expect(plan.byKind).toEqual({ note: 2, task: 1, shopping: 0 });
    expect(plan.futureReminders).toBe(1);
    expect(plan.pastReminders).toBe(1);
    expect(plan.newCount).toBe(2);
    expect(plan.removedCount).toBe(1);
    expect(plan.oldestCreatedAt).toBe(1_700_000_000_000);
    expect(plan.newestCreatedAt).toBe(1_700_000_000_000);
  });
});
