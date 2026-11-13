/**
 * The three-way kind switch, used both when capturing and when editing.
 *
 * Extracted so capture and edit can never drift apart visually: change it here
 * and both screens follow.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme';
import { ITEM_KINDS, KIND_LABEL, type ItemKind } from '@/types';

type Props = {
  value: ItemKind;
  onChange: (kind: ItemKind) => void;
  /** True while the saved items are still being read. */
  disabled?: boolean;
};

export function KindPicker({ value, onChange, disabled = false }: Props) {
  return (
    <View style={styles.row}>
      {ITEM_KINDS.map((kind) => {
        const selected = kind === value;
        return (
          <Pressable
            key={kind}
            onPress={() => onChange(kind)}
            disabled={disabled}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={`Kind: ${KIND_LABEL[kind]}`}
            style={({ pressed }) => [
              styles.pill,
              selected && styles.pillSelected,
              pressed && !selected && styles.pillPressed,
              disabled && styles.pillDisabled,
            ]}>
            <Text style={[styles.label, selected && styles.labelSelected]}>
              {KIND_LABEL[kind]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pillPressed: {
    backgroundColor: colors.limeWash,
  },
  pillSelected: {
    backgroundColor: colors.lime,
    borderColor: colors.lime,
  },
  pillDisabled: {
    opacity: 0.5,
  },
  label: {
    ...typography.meta,
    color: colors.plumMuted,
  },
  labelSelected: {
    color: colors.plum,
  },
});
