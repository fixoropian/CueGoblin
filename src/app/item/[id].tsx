/**
 * One item, opened for reading and editing.
 *
 * Edits are local until you tap Save. That is deliberately explicit rather than
 * autosaving: as a beginner it is easier to see exactly when data is written,
 * and you can always back out of a change.
 */
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KindPicker } from '@/components/KindPicker';
import { ReminderDiagnostics } from '@/components/ReminderDiagnostics';
import { formatRelativeTime, formatReminderTime } from '@/lib/format';
import {
  cancelItemReminder,
  scheduleItemReminder,
  type ReminderAttempt,
} from '@/notifications/reminders';
import { useItems, type ItemChanges } from '@/store/items';
import { cardShadow, colors, radius, spacing, typography } from '@/theme';
import { KIND_LABEL, type Item, type ItemKind } from '@/types';

export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { items, isReady, updateItem, removeItem } = useItems();

  const item = items.find((entry) => entry.id === id);

  // Storage is still loading (or failed): show the page background, not a
  // premature "deleted" message.
  if (!isReady) {
    return <View style={styles.screen} />;
  }

  if (!item) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.missingTitle}>This item is gone</Text>
        <Text style={styles.missingBody}>It was deleted. Nothing else to see here.</Text>
        <Pressable onPress={() => router.back()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonLabel}>Back to list</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ItemEditor
      // Keying by id means opening a different item remounts the editor with
      // fresh state instead of reusing the previous item's draft.
      key={item.id}
      item={item}
      topInset={insets.top}
      bottomInset={insets.bottom}
      onSave={async (changes) => {
        // Save the item and date first. A notification failure must not roll
        // back the user's saved content or erase an existing reminder date.
        updateItem(item.id, changes);

        const reminderAt = changes.reminderAt ?? null;
        if (reminderAt === null) {
          await cancelItemReminder(item.id);
          return null;
        }

        // An old one-off reminder that already fired is history, not something
        // to schedule again. Editing the item should still be allowed.
        if (reminderAt === item.reminderAt && reminderAt <= Date.now()) {
          return null;
        }

        return scheduleItemReminder({
          itemId: item.id,
          text: changes.text ?? item.text,
          reminderAt,
        });
      }}
      onDelete={() => {
        Alert.alert('Delete this item?', 'This cannot be undone.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              removeItem(item.id);
              void cancelItemReminder(item.id);
              router.back();
            },
          },
        ]);
      }}
      onClose={() => router.back()}
    />
  );
}

type EditorProps = {
  item: Item;
  topInset: number;
  bottomInset: number;
  onSave: (changes: ItemChanges) => Promise<ReminderAttempt | null>;
  onDelete: () => void;
  onClose: () => void;
};

type PickerMode = 'date' | 'time' | null;

function defaultReminderDate(): Date {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setSeconds(0, 0);
  return date;
}

function ItemEditor({ item, topInset, bottomInset, onSave, onDelete, onClose }: EditorProps) {
  const [text, setText] = useState(item.text);
  const [kind, setKind] = useState<ItemKind>(item.kind);
  const [done, setDone] = useState(item.done);
  const [reminderAt, setReminderAt] = useState<number | null>(item.reminderAt ?? null);
  const [draftDate, setDraftDate] = useState(defaultReminderDate);
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [attempt, setAttempt] = useState<ReminderAttempt | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const trimmed = text.trim();
  const reminderChanged = reminderAt !== (item.reminderAt ?? null);
  const canRetry = attempt !== null && !attempt.ok;
  const canSave =
    trimmed.length > 0 &&
    (trimmed !== item.text ||
      kind !== item.kind ||
      done !== item.done ||
      reminderChanged ||
      canRetry) &&
    !saving;

  const permissionFailed =
    attempt?.steps.some(
      (step) => step.stage === 'permission-request' && step.status === 'failed',
    ) ?? false;

  function handleKindChange(nextKind: ItemKind) {
    setKind(nextKind);
    // Notes have no "done" state, so ticking a task and then turning it into a
    // note should not leave a hidden tick behind.
    if (nextKind === 'note') setDone(false);
  }

  function openPicker() {
    setSaveError(null);
    setDraftDate(reminderAt ? new Date(reminderAt) : defaultReminderDate());
    setPickerMode('date');
  }

  function applyReminder(next: Date) {
    setPickerMode(null);
    setAttempt(null);
    setSaveError(null);

    if (next.getTime() <= Date.now()) {
      setSaveError('That time has already passed. Choose a future date and time.');
      return;
    }

    setReminderAt(next.getTime());
  }

  function handleAndroidPicker(event: DateTimePickerEvent, selected?: Date) {
    if (event.type === 'dismissed' || !selected) {
      setPickerMode(null);
      return;
    }

    if (pickerMode === 'date') {
      const next = new Date(draftDate);
      next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
      setDraftDate(next);
      // Android cannot show a combined date/time dialog.
      setPickerMode('time');
      return;
    }

    const next = new Date(draftDate);
    next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    applyReminder(next);
  }

  async function handleSave() {
    if (!canSave) return;

    if (reminderAt !== null && reminderAt <= Date.now() && reminderChanged) {
      setSaveError('That reminder time has already passed. Choose a future time or remove it.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    setAttempt(null);

    try {
      const result = await onSave({ text: trimmed, kind, done, reminderAt });

      // No reminder to schedule, or scheduling succeeded.
      if (!result || result.ok) {
        onClose();
        return;
      }

      // The item and date are already saved. Keep this screen open so the
      // separate stage results (and full stack) remain available.
      setAttempt(result);
    } catch (error) {
      console.error('[CueGoblin reminders][save] Saving the reminder threw unexpectedly', error);
      setSaveError(
        error instanceof Error
          ? `${error.message}\n${error.stack ?? ''}`
          : 'Saving the reminder failed with an unknown error.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.container, { paddingTop: topInset + spacing.md }]}>
        <View style={styles.topBar}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
            <Text style={styles.secondaryButtonLabel}>Cancel</Text>
          </Pressable>

          <Pressable
            onPress={() => void handleSave()}
            disabled={!canSave}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave }}
            style={({ pressed }) => [
              styles.saveButton,
              !canSave && styles.saveButtonDisabled,
              pressed && canSave && styles.saveButtonPressed,
            ]}>
            <Text style={styles.saveButtonLabel}>{saving ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <View style={styles.editor}>
            <KindPicker value={kind} onChange={handleKindChange} />

            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              textAlignVertical="top"
              style={styles.textInput}
              placeholder="Write something…"
              placeholderTextColor={colors.plumFaint}
              accessibilityLabel="Item text"
            />

            {kind !== 'note' ? (
              <Pressable
                onPress={() => setDone((current) => !current)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done }}
                style={styles.doneRow}>
                <View style={[styles.checkbox, done && styles.checkboxDone]}>
                  {done ? <Text style={styles.checkboxTick}>✓</Text> : null}
                </View>
                <Text style={styles.doneLabel}>{done ? 'Done' : 'Mark as done'}</Text>
              </Pressable>
            ) : null}

            <View style={styles.reminderSection}>
              <Text style={styles.reminderHeading}>REMINDER</Text>
              <Text style={reminderAt ? styles.reminderValue : styles.reminderEmpty}>
                {reminderAt
                  ? formatReminderTime(reminderAt)
                  : 'No reminder set for this item.'}
              </Text>

              <View style={styles.reminderActions}>
                <Pressable
                  onPress={openPicker}
                  accessibilityRole="button"
                  accessibilityLabel={reminderAt ? 'Change reminder' : 'Choose reminder date and time'}
                  style={({ pressed }) => [
                    styles.reminderButton,
                    pressed && styles.reminderButtonPressed,
                  ]}>
                  <Text style={styles.reminderButtonLabel}>
                    {reminderAt ? 'Change date & time' : 'Choose date & time'}
                  </Text>
                </Pressable>

                {reminderAt ? (
                  <Pressable
                    onPress={() => {
                      setReminderAt(null);
                      setAttempt(null);
                      setSaveError(null);
                    }}
                    hitSlop={8}
                    accessibilityRole="button">
                    <Text style={styles.removeReminderLabel}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>

              {Platform.OS === 'ios' && pickerMode ? (
                <DateTimePicker
                  value={draftDate}
                  mode="datetime"
                  minimumDate={new Date()}
                  onChange={(event: DateTimePickerEvent, selected?: Date) => {
                    if (event.type === 'dismissed' || !selected) {
                      setPickerMode(null);
                      return;
                    }
                    applyReminder(selected);
                  }}
                />
              ) : null}

              {Platform.OS === 'android' && pickerMode === 'date' ? (
                <DateTimePicker
                  value={draftDate}
                  mode="date"
                  minimumDate={new Date()}
                  onChange={handleAndroidPicker}
                />
              ) : null}

              {Platform.OS === 'android' && pickerMode === 'time' ? (
                <DateTimePicker
                  value={draftDate}
                  mode="time"
                  is24Hour={false}
                  onChange={handleAndroidPicker}
                />
              ) : null}

              <Text style={styles.reminderHint}>
                The alert is scheduled on this phone. Keep CueGoblin installed so Android can
                    deliver it.
              </Text>
            </View>
          </View>

          {saveError ? (
            <Text selectable style={styles.saveError}>
              {saveError}
            </Text>
          ) : null}

          {attempt ? (
            <ReminderDiagnostics
              steps={attempt.steps}
              canOpenSettings={permissionFailed}
              onOpenSettings={() => void Linking.openSettings()}
            />
          ) : null}

          <View style={styles.footer}>
            <Text style={styles.hint}>
              Changes are only kept when you tap Save.
              {'\n'}Saved as a {KIND_LABEL[kind].toLowerCase()} · edited{' '}
              {formatRelativeTime(item.updatedAt)}
            </Text>

            <Pressable onPress={onDelete} hitSlop={8} accessibilityRole="button">
              <Text style={styles.deleteLabel}>Delete item</Text>
            </Pressable>
          </View>

          <View style={{ height: bottomInset }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ivory,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    gap: spacing.lg,
    paddingBottom: spacing.lg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  secondaryButtonLabel: {
    ...typography.body,
    color: colors.plumMuted,
  },
  saveButton: {
    backgroundColor: colors.lime,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 1,
  },
  saveButtonPressed: {
    backgroundColor: colors.limePressed,
  },
  saveButtonDisabled: {
    opacity: 0.35,
  },
  saveButtonLabel: {
    ...typography.button,
    color: colors.plum,
  },
  editor: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.lg,
    ...cardShadow,
  },
  textInput: {
    ...typography.input,
    minHeight: 140,
    paddingTop: spacing.xs,
  },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  checkbox: {
    width: 25,
    height: 25,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.plumMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: {
    backgroundColor: colors.lime,
    borderColor: colors.lime,
  },
  checkboxTick: {
    color: colors.plum,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  doneLabel: {
    ...typography.body,
    color: colors.plumMuted,
  },
  reminderSection: {
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.lg,
  },
  reminderHeading: {
    ...typography.meta,
  },
  reminderValue: {
    ...typography.body,
  },
  reminderEmpty: {
    ...typography.hint,
  },
  reminderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    flexWrap: 'wrap',
  },
  reminderButton: {
    backgroundColor: colors.limeWash,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  reminderButtonPressed: {
    backgroundColor: colors.lime,
  },
  reminderButtonLabel: {
    ...typography.button,
    color: colors.plum,
  },
  removeReminderLabel: {
    ...typography.button,
    color: colors.danger,
  },
  reminderHint: {
    ...typography.hint,
  },
  saveError: {
    ...typography.hint,
    color: colors.danger,
  },
  footer: {
    marginTop: 'auto',
    gap: spacing.lg,
    paddingBottom: spacing.lg,
  },
  hint: {
    ...typography.hint,
  },
  deleteLabel: {
    ...typography.button,
    color: colors.danger,
  },
  missingTitle: {
    ...typography.title,
  },
  missingBody: {
    ...typography.hint,
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: spacing.md,
    backgroundColor: colors.lime,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  primaryButtonLabel: {
    ...typography.button,
    color: colors.plum,
  },
});
