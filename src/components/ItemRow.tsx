/**
 * One saved item in the list.
 *
 * The whole row opens the editor; the round checkbox on the left ticks a task or
 * shopping item off without leaving the list. Notes have no checkbox because
 * "done" does not mean anything for them.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatRelativeTime } from '@/lib/format';
import { cardShadow, colors, radius, spacing, typography } from '@/theme';
import { KIND_LABEL, type Item } from '@/types';

type Props = {
  item: Item;
  onPress: () => void;
  onToggle: () => void;
};

export function ItemRow({ item, onPress, onToggle }: Props) {
  const canToggle = item.kind !== 'note';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${KIND_LABEL[item.kind]}: ${item.text}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      {canToggle ? (
        <Pressable
          onPress={onToggle}
          hitSlop={10}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: item.done }}
          accessibilityLabel={item.done ? 'Mark as not done' : 'Mark as done'}
          style={[styles.checkbox, item.done && styles.checkboxDone]}>
          {item.done ? <Text style={styles.checkboxTick}>✓</Text> : null}
        </Pressable>
      ) : (
        <View style={styles.noteDot} />
      )}

      <View style={styles.body}>
        <Text style={[styles.text, item.done && styles.textDone]} numberOfLines={3}>
          {item.text}
        </Text>
        <Text style={styles.meta}>
          {KIND_LABEL[item.kind]} · {formatRelativeTime(item.updatedAt)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    ...cardShadow,
  },
  rowPressed: {
    backgroundColor: colors.limeWash,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.plumMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
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
  noteDot: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 3,
  },
  text: {
    ...typography.body,
  },
  textDone: {
    color: colors.plumFaint,
    textDecorationLine: 'line-through',
  },
  meta: {
    ...typography.meta,
  },
});
