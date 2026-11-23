/**
 * The restore sequence, written as one explicit pipeline.
 *
 * The order is the safety mechanism:
 *
 *   1. safety copy  — written and read back before anything else changes
 *   2. item data    — written and confirmed before any reminder is touched
 *   3. reminders    — cancelled, then rescheduled for future times only
 *   4. report       — one of three outcomes, never a vague "done"
 *
 * A failure in step 1 aborts with nothing changed. A failure in step 2 aborts
 * with reminders untouched. Step 3 cannot be rolled back without rewriting the
 * data, so its failures are reported per item instead of being hidden: a
 * restore whose reminders partly failed is reported as
 * `restored-with-problems`, and the word "restored" is never used for an
 * outcome where the data itself did not land.
 *
 * Every side effect is injected, which is what lets the whole failure matrix be
 * tested without a phone.
 */
import type { Item, ItemKind } from '@/types';

import { canonicalItems, type Backup } from './format';

export type RestorePlan = {
  incomingCount: number;
  currentCount: number;
  byKind: Record<ItemKind, number>;
  /** Reminders that will actually be scheduled (timestamp still in the future). */
  futureReminders: number;
  /** Reminders kept on the item as history but not rescheduled. */
  pastReminders: number;
  newCount: number;
  removedCount: number;
  oldestCreatedAt: number | null;
  newestCreatedAt: number | null;
};

export function planRestore(
  currentItems: Item[],
  backup: Backup,
  now: number = Date.now(),
): RestorePlan {
  const byKind: Record<ItemKind, number> = { note: 0, task: 0, shopping: 0 };
  const currentIds = new Set(currentItems.map((item) => item.id));
  const incomingIds = new Set(backup.items.map((item) => item.id));

  let futureReminders = 0;
  let pastReminders = 0;
  let oldestCreatedAt: number | null = null;
  let newestCreatedAt: number | null = null;

  for (const item of backup.items) {
    byKind[item.kind] += 1;

    if (typeof item.reminderAt === 'number') {
      if (item.reminderAt > now) futureReminders += 1;
      else pastReminders += 1;
    }

    if (oldestCreatedAt === null || item.createdAt < oldestCreatedAt) {
      oldestCreatedAt = item.createdAt;
    }
    if (newestCreatedAt === null || item.createdAt > newestCreatedAt) {
      newestCreatedAt = item.createdAt;
    }
  }

  return {
    incomingCount: backup.items.length,
    currentCount: currentItems.length,
    byKind,
    futureReminders,
    pastReminders,
    newCount: backup.items.filter((item) => !currentIds.has(item.id)).length,
    removedCount: currentItems.filter((item) => !incomingIds.has(item.id)).length,
    oldestCreatedAt,
    newestCreatedAt,
  };
}

export type ReminderFailure = {
  itemId: string;
  text: string;
  message: string;
};

export type CancelFailure = {
  itemId: string;
  text: string;
  message: string;
};

export type RestoreOutcome =
  | {
      /** Nothing was restored. `stage` says where it stopped. */
      status: 'not-restored';
      stage: 'copy' | 'storage';
      message: string;
      /**
       * Only set for a failed storage write: whether a re-read showed storage
       * still matching the old list ('unchanged') or something else ('changed').
       */
      storedState?: 'unchanged' | 'changed';
      safetyCopyName?: string;
    }
  | {
      status: 'restored';
      itemCount: number;
      scheduledCount: number;
      expiredCount: number;
      cancelledCount: number;
      safetyCopyName: string;
    }
  | {
      status: 'restored-with-problems';
      itemCount: number;
      scheduledCount: number;
      expiredCount: number;
      cancelledCount: number;
      cancelFailures: CancelFailure[];
      scheduleFailures: ReminderFailure[];
      safetyCopyName: string;
    };

export type RestoreDeps = {
  /** Reads the identifiers currently queued in the OS, for the safety copy. */
  listScheduledReminderIds: () => Promise<string[]>;
  /** Writes and verifies the safety copy. Must not throw. */
  writeSafetyCopy: (
    items: Item[],
    scheduledReminderIds: string[],
  ) => Promise<{ ok: true; name: string } | { ok: false; message: string }>;
  /** Persists the restored list. Memory must only change when this succeeds. */
  replaceItems: (items: Item[]) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Re-reads storage, used to describe what a failed write left behind. */
  readStoredItems: () => Promise<{ ok: true; items: Item[] } | { ok: false; message: string }>;
  cancelReminder: (itemId: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  scheduleReminder: (item: Item) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Optional tidy-up, run only once the data write has succeeded. */
  pruneSafetyCopies?: () => Promise<void>;
};

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

/** Safety copy first. If this does not succeed, nothing else is attempted. */
async function writeSafetyCopyOrAbort(
  current: Item[],
  deps: RestoreDeps,
): Promise<
  | { ok: true; name: string }
  | { ok: false; outcome: Extract<RestoreOutcome, { status: 'not-restored' }> }
> {
  let scheduledIds: string[];
  try {
    scheduledIds = await deps.listScheduledReminderIds();
  } catch (error) {
    // Without the queued identifiers the safety copy would be incomplete, and an
    // incomplete safety copy is not a safety copy. Stop here.
    return {
      ok: false,
      outcome: {
        status: 'not-restored',
        stage: 'copy',
        message: `Could not read the reminders already scheduled on this phone, so no safety copy was written: ${describeError(error)}`,
      },
    };
  }

  let copy: { ok: true; name: string } | { ok: false; message: string };
  try {
    copy = await deps.writeSafetyCopy(current, scheduledIds);
  } catch (error) {
    copy = { ok: false, message: describeError(error) };
  }

  if (!copy.ok) {
    return {
      ok: false,
      outcome: {
        status: 'not-restored',
        stage: 'copy',
        message: `The safety copy of your current ${current.length} item${current.length === 1 ? '' : 's'} could not be created and verified, so the restore was stopped before cancelling any reminders or changing any data. ${copy.message}`,
      },
    };
  }

  return { ok: true, name: copy.name };
}

export async function applyRestore(options: {
  current: Item[];
  backup: Backup;
  deps: RestoreDeps;
  now?: number;
}): Promise<RestoreOutcome> {
  const { current, backup, deps } = options;
  const now = options.now ?? Date.now();

  // 1. Safety copy gate.
  const copy = await writeSafetyCopyOrAbort(current, deps);
  if (!copy.ok) return copy.outcome;

  // 2. Data. Written before any reminder is cancelled, so a failed write leaves
  //    the reminder state exactly as it was.
  let saved: { ok: true } | { ok: false; message: string };
  try {
    saved = await deps.replaceItems(backup.items);
  } catch (error) {
    saved = { ok: false, message: describeError(error) };
  }

  if (!saved.ok) {
    let storedState: 'unchanged' | 'changed' = 'changed';
    try {
      const reread = await deps.readStoredItems();
      storedState =
        reread.ok && canonicalItems(reread.items) === canonicalItems(current)
          ? 'unchanged'
          : 'changed';
    } catch {
      // If we cannot even re-read, we must assume the worst and say so.
      storedState = 'changed';
    }

    return {
      status: 'not-restored',
      stage: 'storage',
      storedState,
      message: saved.message,
      safetyCopyName: copy.name,
    };
  }

  // The restored items are now the truth on this device. From here on a failure
  // is reported, not rolled back.
  const scheduledIdsBeforeRestore = new Set(current.map((item) => item.id));
  const restoredIds = new Set(backup.items.map((item) => item.id));

  const textById = new Map<string, string>();
  for (const item of current) textById.set(item.id, item.text);
  for (const item of backup.items) textById.set(item.id, item.text);

  // 3a. Clear every reminder that could belong to an item on either side. A
  //     restored item that has no reminder must not inherit the old alert, and a
  //     restored item with a reminder is rescheduled below.
  const cancelFailures: CancelFailure[] = [];
  let cancelledCount = 0;
  const idsToCancel = new Set<string>([...scheduledIdsBeforeRestore, ...restoredIds]);
  for (const itemId of idsToCancel) {
    let result: { ok: true } | { ok: false; message: string };
    try {
      result = await deps.cancelReminder(itemId);
    } catch (error) {
      result = { ok: false, message: describeError(error) };
    }

    if (result.ok) {
      cancelledCount += 1;
    } else {
      cancelFailures.push({
        itemId,
        text: textById.get(itemId) ?? itemId,
        message: result.message,
      });
    }
  }

  // 3b. Schedule only reminders that are still in the future. Past timestamps
  //     stay on the item as history, which matches the editor's rule.
  const scheduleFailures: ReminderFailure[] = [];
  let scheduledCount = 0;
  let expiredCount = 0;

  for (const item of backup.items) {
    const reminderAt = item.reminderAt;
    if (typeof reminderAt !== 'number') continue;

    if (reminderAt <= now) {
      expiredCount += 1;
      continue;
    }

    let result: { ok: true } | { ok: false; message: string };
    try {
      result = await deps.scheduleReminder(item);
    } catch (error) {
      result = { ok: false, message: describeError(error) };
    }

    if (result.ok) {
      scheduledCount += 1;
    } else {
      scheduleFailures.push({
        itemId: item.id,
        text: item.text,
        message: result.message,
      });
    }
  }

  // 4. Tidy up old safety copies only now: a restore that never reached this
  //    point must leave every copy in place.
  if (deps.pruneSafetyCopies) {
    try {
      await deps.pruneSafetyCopies();
    } catch (error) {
      // Pruning is housekeeping. Never turn it into a restore failure.
      console.warn('[CueGoblin backup] Could not tidy old safety copies', error);
    }
  }

  const summary = {
    itemCount: backup.items.length,
    scheduledCount,
    expiredCount,
    cancelledCount,
    safetyCopyName: copy.name,
  };

  if (cancelFailures.length > 0 || scheduleFailures.length > 0) {
    return {
      status: 'restored-with-problems',
      ...summary,
      cancelFailures,
      scheduleFailures,
    };
  }

  return { status: 'restored', ...summary };
}
