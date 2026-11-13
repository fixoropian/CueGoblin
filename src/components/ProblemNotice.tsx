/**
 * A calm panel for telling you something went wrong, with an optional action.
 *
 * Used in two places: when your saved items could not be read (Try again), and
 * when a change could not be written to the device (Try again).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { cardShadow, colors, radius, spacing, typography } from '@/theme';

type Props = {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function ProblemNotice({ title, message, actionLabel, onAction }: Props) {
  return (
    <View style={styles.card} accessibilityRole="alert">
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>

      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
          <Text style={styles.buttonLabel}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: spacing.lg,
    gap: spacing.sm,
    ...cardShadow,
  },
  title: {
    ...typography.body,
    fontWeight: '700',
    color: colors.danger,
  },
  message: {
    ...typography.hint,
    color: colors.plumMuted,
  },
  button: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    backgroundColor: colors.lime,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  buttonPressed: {
    backgroundColor: colors.limePressed,
  },
  buttonLabel: {
    ...typography.button,
    color: colors.plum,
  },
});
