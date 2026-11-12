/**
 * The capture box: one text field, a kind picker, one lime button.
 *
 * It owns its draft text locally so typing never re-renders the whole list.
 * The chosen kind sticks after saving, because people usually capture a few of
 * the same kind in a row (three shopping items, then a note).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { KindPicker } from '@/components/KindPicker';
import { cardShadow, colors, radius, spacing, typography } from '@/theme';
import type { ItemKind } from '@/types';

type Props = {
  onAdd: (text: string, kind: ItemKind) => void;
};

export function CaptureBar({ onAdd }: Props) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<ItemKind>('note');

  const trimmed = text.trim();
  const canSave = trimmed.length > 0;

  function handleAdd() {
    if (!canSave) return;
    onAdd(trimmed, kind);
    setText('');
  }

  return (
    <View style={styles.card}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="What's on your mind?"
        placeholderTextColor={colors.plumFaint}
        style={styles.input}
        multiline
        // Multiline inputs render top-aligned on Android only with this hint.
        textAlignVertical="top"
        accessibilityLabel="New item text"
      />

      <View style={styles.footer}>
        <KindPicker value={kind} onChange={setKind} />

        <Pressable
          onPress={handleAdd}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel="Save item"
          accessibilityState={{ disabled: !canSave }}
          style={({ pressed }) => [
            styles.addButton,
            !canSave && styles.addButtonDisabled,
            pressed && canSave && styles.addButtonPressed,
          ]}>
          <Text style={styles.addButtonLabel}>Add</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.md,
    ...cardShadow,
  },
  input: {
    ...typography.input,
    minHeight: 52,
    maxHeight: 160,
    paddingTop: spacing.xs,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  addButton: {
    backgroundColor: colors.lime,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  addButtonPressed: {
    backgroundColor: colors.limePressed,
  },
  addButtonDisabled: {
    opacity: 0.35,
  },
  addButtonLabel: {
    ...typography.button,
    color: colors.plum,
  },
});
