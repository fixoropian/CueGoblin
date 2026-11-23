/**
 * Backup and restore, entirely on the phone.
 *
 * The screen is deliberately plain about consequences: export says what file it
 * wrote, restore shows a preview of exactly what would change, and the result is
 * one of three honest states — fully restored, restored with reminder problems,
 * or not restored. Nothing is called a success until the data is on disk.
 *
 * The restore sequence itself lives in `src/backup/restore.ts`; this file only
 * wires it to the store, the notification queue and the file system.
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { exportBackup, pickBackupFile, readBackupFile } from '@/backup/files';
import type { Backup } from '@/backup/format';
import type { RestoreOutcome, RestorePlan } from '@/backup/restore';
import type { Item } from '@/types';
import { applyRestore, planRestore } from '@/backup/restore';
import {
  listSafetyCopies,
  pruneSafetyCopies,
  saveCopyToFolder,
  writeVerifiedSafetyCopy,
  type SafetyCopyEntry,
} from '@/backup/safety';
import { ProblemNotice } from '@/components/ProblemNotice';
import { formatReminderTime } from '@/lib/format';
import {
  cancelItemReminderChecked,
  listScheduledReminderIds,
  scheduleItemReminder,
} from '@/notifications/reminders';
import { loadItems } from '@/storage/items';
import { useItems } from '@/store/items';
import { cardShadow, colors, radius, spacing, typography } from '@/theme';

type Notice = {
  kind: 'ok' | 'error' | 'info';
  title: string;
  message: string;
};

type Preview = {
  backup: Backup;
  fileName: string;
  plan: RestorePlan;
};

type Busy = 'export' | 'pick' | 'read' | 'restore' | 'save-copy' | null;

function plural(count: number, singular: string, pluralWord: string = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

function nextReminderAt(backup: Backup): number | null {
  const now = Date.now();
  const future = backup.items
    .map((item) => item.reminderAt)
    .filter((value): value is number => typeof value === 'number' && value > now);

  return future.length === 0 ? null : Math.min(...future);
}

function scheduleFailureMessage(outcome: Extract<RestoreOutcome, { status: 'restored-with-problems' }>): string {
  const parts: string[] = [
    `${plural(outcome.itemCount, 'item')} are on this phone now. ${plural(outcome.scheduledCount, 'reminder')} scheduled, ${plural(outcome.expiredCount, 'past reminder')} kept as history.`,
  ];

  if (outcome.cancelFailures.length > 0) {
    parts.push(
      `${plural(outcome.cancelFailures.length, 'previous reminder')} could not be cancelled and may still fire:\n${outcome.cancelFailures
        .slice(0, 5)
        .map((failure) => `• ${failure.text} — ${failure.message}`)
        .join('\n')}`,
    );
  }

  if (outcome.scheduleFailures.length > 0) {
    parts.push(
      `${plural(outcome.scheduleFailures.length, 'reminder')} could not be scheduled:\n${outcome.scheduleFailures
        .slice(0, 5)
        .map((failure) => `• ${failure.text} — ${failure.message}`)
        .join('\n')}`,
    );
  }

  parts.push(`Safety copy: ${outcome.safetyCopyName}`);
  return parts.join('\n\n');
}

export default function BackupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { items, isReady, replaceAllItems } = useItems();

  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [outcome, setOutcome] = useState<RestoreOutcome | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [copies, setCopies] = useState<SafetyCopyEntry[]>([]);

  const isWeb = Platform.OS === 'web';
  const working = busy !== null;

  const refreshCopies = useCallback(() => {
    if (isWeb) return;
    void listSafetyCopies().then(setCopies);
  }, [isWeb]);

  useEffect(() => {
    refreshCopies();
  }, [refreshCopies]);

  /**
   * The side effects restores depend on. Scheduling reuses the item editor's
   * reminder code, so channel creation, permissions and replacement behave the
   * same way they do when a reminder is saved from an item.
   */
  const deps = useMemo(
    () => ({
      listScheduledReminderIds,
      writeSafetyCopy: (currentItems: Item[], scheduledReminderIds: string[]) =>
        writeVerifiedSafetyCopy({ items: currentItems, scheduledReminderIds }),
      replaceItems: replaceAllItems,
      readStoredItems: loadItems,
      cancelReminder: (itemId: string) => cancelItemReminderChecked(itemId),
      scheduleReminder: async (restored: Item) => {
        if (typeof restored.reminderAt !== 'number') {
          return { ok: false as const, message: 'This item has no reminder time.' };
        }

        const attempt = await scheduleItemReminder({
          itemId: restored.id,
          text: restored.text,
          reminderAt: restored.reminderAt,
        });

        if (attempt.ok) return { ok: true as const };
        if (attempt.cancelled) {
          return { ok: false as const, message: 'Scheduling was cancelled.' };
        }

        const failed = attempt.steps.find((step) => step.status === 'failed');
        return {
          ok: false as const,
          message:
            failed?.error?.message ?? failed?.detail ?? 'The reminder could not be scheduled.',
        };
      },
      pruneSafetyCopies: async () => {
        await pruneSafetyCopies();
      },
    }),
    [replaceAllItems],
  );

  async function handleExport() {
    setBusy('export');
    setNotice(null);

    try {
      const result = await exportBackup(items);

      if (result.ok) {
        setNotice({
          kind: 'ok',
          title: 'Backup saved',
          message: `${result.fileName} holds ${plural(items.length, 'item')}. Keep it somewhere you will find it again.`,
        });
      } else if (!result.canceled) {
        setNotice({ kind: 'error', title: 'Nothing was exported', message: result.message });
      }
    } finally {
      setBusy(null);
    }
  }

  async function handlePick() {
    setBusy('pick');
    setNotice(null);
    setOutcome(null);

    try {
      const picked = await pickBackupFile();

      if (picked.status === 'canceled') {
        setNotice({ kind: 'info', title: 'No file chosen', message: 'Nothing was changed.' });
        return;
      }

      if (picked.status === 'failed') {
        setNotice({ kind: 'error', title: 'Could not open that file', message: picked.message });
        return;
      }

      setBusy('read');
      const parsed = await readBackupFile(picked.file);

      if (!parsed.ok) {
        setPreview(null);
        setNotice({ kind: 'error', title: 'Nothing was restored', message: parsed.message });
        return;
      }

      setPreview({
        backup: parsed.value,
        fileName: picked.name,
        plan: planRestore(items, parsed.value),
      });
    } finally {
      setBusy(null);
    }
  }

  async function runRestore() {
    if (!preview) return;

    setBusy('restore');
    setNotice(null);
    setOutcome(null);

    try {
      const result = await applyRestore({ current: items, backup: preview.backup, deps });
      setOutcome(result);
      setPreview(null);
      refreshCopies();
    } finally {
      setBusy(null);
    }
  }

  function confirmRestore() {
    if (!preview) return;

    const { plan, fileName } = preview;

    Alert.alert(
      `Replace all ${plural(plan.currentCount, 'item')}?`,
      [
        `This restores ${plural(plan.incomingCount, 'item')} from ${fileName} and replaces everything on this phone. It cannot be undone from the app.`,
        `A safety copy of your current ${plural(plan.currentCount, 'item')} is saved and checked first. If that copy cannot be made, nothing is changed.`,
        `${plural(plan.futureReminders, 'reminder')} will be scheduled; ${plural(plan.pastReminders, 'past reminder')} will be kept as history.`,
      ].join('\n\n'),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace all items',
          style: 'destructive',
          onPress: () => {
            void runRestore();
          },
        },
      ],
      { cancelable: true },
    );
  }

  async function handleSaveCopy() {
    const newest = copies[0];
    if (!newest) return;

    setBusy('save-copy');
    setNotice(null);

    try {
      const result = await saveCopyToFolder(newest.name);

      if (result.ok) {
        setNotice({
          kind: 'ok',
          title: 'Safety copy saved',
          message: `${result.fileName} was copied to the folder you chose.`,
        });
      } else if (!result.canceled) {
        setNotice({ kind: 'error', title: 'Safety copy not saved', message: result.message });
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          <Text style={styles.secondaryLabel}>Back</Text>
        </Pressable>
        <Text style={styles.topTitle}>Backup</Text>
        <View style={styles.topSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}>
        <Text style={styles.lede}>
          Everything stays on this phone. A backup is one JSON file you choose where to keep.
        </Text>

        {isWeb ? (
          <ProblemNotice
            title="Not available in the browser"
            message="Backup and restore need the phone's file picker. Open CueGoblin on Android or iOS to use them."
          />
        ) : null}

        {notice ? (
          notice.kind === 'error' ? (
            <ProblemNotice title={notice.title} message={notice.message} />
          ) : (
            <View style={styles.notice} accessibilityRole="alert">
              <Text style={styles.noticeTitle}>{notice.title}</Text>
              <Text style={styles.noticeMessage}>{notice.message}</Text>
            </View>
          )
        ) : null}

        {outcome ? <OutcomePanel outcome={outcome} /> : null}

        {!isWeb && !isReady ? (
          <Text style={styles.hint}>Getting your saved items… backup opens once they are loaded.</Text>
        ) : null}

        {!isWeb ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>EXPORT</Text>
            <Text style={styles.hint}>
              Writes every item, including reminder times, to a file you pick a folder for.
            </Text>
            <Pressable
              onPress={() => void handleExport()}
              disabled={!isReady || working}
              accessibilityRole="button"
              accessibilityState={{ disabled: !isReady || working }}
              style={({ pressed }) => [
                styles.primaryButton,
                (!isReady || working) && styles.buttonDisabled,
                pressed && isReady && !working && styles.primaryButtonPressed,
              ]}>
              <Text style={styles.primaryButtonLabel}>
                {busy === 'export' ? 'Exporting…' : 'Export all items…'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {!isWeb ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>RESTORE</Text>
            <Text style={styles.hint}>
              Choose a CueGoblin backup file. You will see exactly what it contains before anything
              changes.
            </Text>
            <Pressable
              onPress={() => void handlePick()}
              disabled={working || preview !== null}
              accessibilityRole="button"
              accessibilityState={{ disabled: working || preview !== null }}
              style={({ pressed }) => [
                styles.secondaryButton,
                (working || preview !== null) && styles.buttonDisabled,
                pressed && styles.secondaryButtonPressed,
              ]}>
              <Text style={styles.secondaryButtonLabel}>
                {busy === 'pick' || busy === 'read' ? 'Reading…' : 'Choose a backup file…'}
              </Text>
            </Pressable>

            {preview ? (
              <View style={styles.previewCard}>
                <Text style={styles.previewTitle}>{preview.fileName}</Text>
                <Text style={styles.previewLine}>
                  Exported {new Date(preview.backup.exportedAt).toLocaleString()}
                </Text>
                <Text style={styles.previewLine}>
                  {plural(preview.plan.incomingCount, 'item')} · {preview.plan.byKind.note} notes ·{' '}
                  {preview.plan.byKind.task} tasks · {preview.plan.byKind.shopping} shopping
                </Text>
                <Text style={styles.previewLine}>
                  {plural(preview.plan.futureReminders, 'reminder')} will be scheduled ·{' '}
                  {plural(preview.plan.pastReminders, 'past reminder')} kept as history
                </Text>
                <Text style={styles.previewLine}>
                  Replaces {plural(preview.plan.currentCount, 'item')} on this phone ·{' '}
                  {plural(preview.plan.removedCount, 'item')} would be removed ·{' '}
                  {plural(preview.plan.newCount, 'new item')}
                </Text>
                {nextReminderAt(preview.backup) !== null ? (
                  <Text style={styles.previewLine}>
                    Next reminder: {formatReminderTime(nextReminderAt(preview.backup) ?? 0)}
                  </Text>
                ) : null}

                <View style={styles.previewActions}>
                  <Pressable
                    onPress={() => {
                      setPreview(null);
                      setNotice(null);
                    }}
                    disabled={working}
                    accessibilityRole="button"
                    hitSlop={8}>
                    <Text style={styles.secondaryButtonLabel}>Discard</Text>
                  </Pressable>

                  <Pressable
                    onPress={confirmRestore}
                    disabled={working || !isReady}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: working || !isReady }}
                    style={({ pressed }) => [
                      styles.dangerButton,
                      (working || !isReady) && styles.buttonDisabled,
                      pressed && styles.dangerButtonPressed,
                    ]}>
                    <Text style={styles.dangerButtonLabel}>
                      {busy === 'restore' ? 'Restoring…' : 'Replace all items…'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {!isWeb ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>SAFETY COPIES</Text>
            <Text style={styles.hint}>
              Every restore writes a timestamped copy of your items first and verifies it. The last
              five are kept. These live inside the app; save one to a folder to keep it elsewhere.
            </Text>

            {copies.length === 0 ? (
              <Text style={styles.hint}>No safety copies yet.</Text>
            ) : (
              <>
                <Text style={styles.previewLine}>
                  Newest: {copies[0].name} ({Math.max(1, Math.round(copies[0].size / 1024))} KB)
                </Text>
                <Pressable
                  onPress={() => void handleSaveCopy()}
                  disabled={working}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: working }}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    working && styles.buttonDisabled,
                    pressed && styles.secondaryButtonPressed,
                  ]}>
                  <Text style={styles.secondaryButtonLabel}>
                    {busy === 'save-copy' ? 'Saving…' : 'Save newest safety copy to a folder…'}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function OutcomePanel({ outcome }: { outcome: RestoreOutcome }) {
  if (outcome.status === 'restored') {
    return (
      <View style={styles.successCard} accessibilityRole="alert">
        <Text style={styles.successTitle}>Restored {plural(outcome.itemCount, 'item')}</Text>
        <Text style={styles.noticeMessage}>
          {plural(outcome.scheduledCount, 'reminder')} scheduled,{' '}
          {plural(outcome.expiredCount, 'past reminder')} kept as history,{' '}
          {plural(outcome.cancelledCount, 'previous reminder')} cancelled.
        </Text>
        <Text style={styles.noticeMessage}>Safety copy: {outcome.safetyCopyName}</Text>
      </View>
    );
  }

  if (outcome.status === 'restored-with-problems') {
    return (
      <ProblemNotice
        title="Restored with reminder problems"
        message={scheduleFailureMessage(outcome)}
      />
    );
  }

  if (outcome.stage === 'copy') {
    return (
      <ProblemNotice
        title="Restore stopped — nothing was changed"
        message={outcome.message}
      />
    );
  }

  if (outcome.storedState === 'unchanged') {
    return (
      <ProblemNotice
        title="Nothing was restored"
        message={`${outcome.message} Your items and reminders are unchanged.${outcome.safetyCopyName ? `\n\nSafety copy: ${outcome.safetyCopyName}` : ''}`}
      />
    );
  }

  return (
    <ProblemNotice
      title="Restore stopped — your items may have changed"
      message={`${outcome.message} Reminders were not touched, but saving the restored items did not report success, so the data on this phone may not match what you see.${outcome.safetyCopyName ? `\n\nSafety copy: ${outcome.safetyCopyName}` : ''}`}
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ivory,
    paddingHorizontal: spacing.lg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.md,
  },
  topTitle: {
    ...typography.body,
    fontWeight: '700',
  },
  topSpacer: {
    width: 40,
  },
  secondaryLabel: {
    ...typography.body,
    color: colors.plumMuted,
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: spacing.xl,
  },
  lede: {
    ...typography.body,
    color: colors.plumMuted,
  },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
    ...cardShadow,
  },
  sectionHeading: {
    ...typography.meta,
  },
  hint: {
    ...typography.hint,
  },
  notice: {
    backgroundColor: colors.limeWash,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  noticeTitle: {
    ...typography.body,
    fontWeight: '700',
  },
  noticeMessage: {
    ...typography.hint,
    color: colors.plumMuted,
  },
  successCard: {
    backgroundColor: colors.limeWash,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lime,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  successTitle: {
    ...typography.body,
    fontWeight: '700',
    color: colors.plum,
  },
  primaryButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    backgroundColor: colors.lime,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
  },
  primaryButtonPressed: {
    backgroundColor: colors.limePressed,
  },
  primaryButtonLabel: {
    ...typography.button,
    color: colors.plum,
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    backgroundColor: colors.limeWash,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  secondaryButtonPressed: {
    backgroundColor: colors.lime,
  },
  secondaryButtonLabel: {
    ...typography.button,
    color: colors.plum,
  },
  dangerButton: {
    backgroundColor: colors.danger,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  dangerButtonPressed: {
    opacity: 0.85,
  },
  dangerButtonLabel: {
    ...typography.button,
    color: colors.ivory,
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  previewCard: {
    marginTop: spacing.sm,
    backgroundColor: colors.ivory,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.xs,
  },
  previewTitle: {
    ...typography.body,
    fontWeight: '700',
  },
  previewLine: {
    ...typography.hint,
    color: colors.plumMuted,
  },
  previewActions: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
});
