/**
 * One item, opened for reading and editing.
 *
 * Edits are local until you tap Save. That is deliberately explicit rather than
 * autosaving: as a beginner it is easier to see exactly when data is written,
 * and you can always back out of a change.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KindPicker } from '@/components/KindPicker';
import { formatRelativeTime } from '@/lib/format';
import { useItems, type ItemChanges } from '@/store/items';
import { cardShadow, colors, radius, spacing, typography } from '@/theme';
import { KIND_LABEL, type Item, type ItemKind } from '@/types';

export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { items, hydrated, updateItem, removeItem } = useItems();

  const item = items.find((entry) => entry.id === id);

  // Storage is still loading: show the page background, not a premature
  // "deleted" message.
  if (!hydrated) {
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
      onSave={(changes) => {
        updateItem(item.id, changes);
        router.back();
      }}
      onDelete={() => {
        Alert.alert('Delete this item?', 'This cannot be undone.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              removeItem(item.id);
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
  onSave: (changes: ItemChanges) => void;
  onDelete: () => void;
  onClose: () => void;
};

function ItemEditor({ item, topInset, bottomInset, onSave, onDelete, onClose }: EditorProps) {
  const [text, setText] = useState(item.text);
  const [kind, setKind] = useState<ItemKind>(item.kind);
  const [done, setDone] = useState(item.done);

  const trimmed = text.trim();
  const canSave =
    trimmed.length > 0 &&
    (trimmed !== item.text || kind !== item.kind || done !== item.done);

  function handleKindChange(nextKind: ItemKind) {
    setKind(nextKind);
    // Notes have no "done" state, so ticking a task and then turning it into a
    // note should not leave a hidden tick behind.
    if (nextKind === 'note') setDone(false);
  }

  function handleSave() {
    if (!canSave) return;
    onSave({ text: trimmed, kind, done });
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
            onPress={handleSave}
            disabled={!canSave}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave }}
            style={({ pressed }) => [
              styles.saveButton,
              !canSave && styles.saveButtonDisabled,
              pressed && canSave && styles.saveButtonPressed,
            ]}>
            <Text style={styles.saveButtonLabel}>Save</Text>
          </Pressable>
        </View>

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
        </View>

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
