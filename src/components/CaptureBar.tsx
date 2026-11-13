/**
 * The capture box: one text field, a kind picker, one lime button.
 *
 * It owns its draft text locally so typing never re-renders the whole list.
 * The chosen kind sticks after saving, because people usually capture a few of
 * the same kind in a row (three shopping items, then a note).
 *
 * `disabled` is used while the saved list is still loading. Capturing then
 * would be unsafe: the first write could save a list that is missing the items
 * still on their way in from storage.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { KindPicker } from '@/components/KindPicker';
import { cardShadow, colors, radius, spacing, typography } from '@/theme';
import type { ItemKind } from '@/types';

type Props = {
  onAdd: (text: string, kind: ItemKind) => void;
  /** True while the saved items are still being read. */
  disabled?: boolean;
};

export function CaptureBar({ onAdd, disabled = false }: Props) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<ItemKind>('note');

  const trimmed = text.trim();
  const canSave = trimmed.length > 0 && !disabled;

  function handleAdd() {
    if (!canSave) return;
    onAdd(trimmed, kind);
    setText('');
  }

  return (
    <View style={[styles.card, disabled && styles.cardDisabled]}>
      <TextInput
        value={text}
        onChangeText={setText}
        editable={!disabled}
        placeholder={disabled ? 'Getting your things…' : "What's on your mind?"}
        placeholderTextColor={colors.plumFaint}
        style={styles.input}
        multiline
        // Multiline inputs render top-aligned on Android only with this hint.
        textAlignVertical="top"
        accessibilityLabel="New item text"
        accessibilityState={{ disabled }}
      />

      <View style={styles.footer}>
        <KindPicker value={kind} onChange={setKind} disabled={disabled} />

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
  cardDisabled: {
    opacity: 0.6,
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
