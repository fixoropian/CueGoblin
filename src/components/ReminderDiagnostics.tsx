/**
 * On-device reminder diagnostics.
 *
 * Each stage gets its own row, status and error block. A later stage never
 * reuses an earlier stage's message, and the full stack is selectable so it can
 * be copied out of the device or read from the Metro logs.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ReminderStep } from '@/notifications/reminders';
import { colors, radius, spacing, typography } from '@/theme';

type Props = {
  steps: ReminderStep[];
  canOpenSettings?: boolean;
  onOpenSettings?: () => void;
};

const STATUS_LABEL = {
  passed: 'PASSED',
  skipped: 'SKIPPED',
  failed: 'FAILED',
} as const;

export function ReminderDiagnostics({ steps, canOpenSettings, onOpenSettings }: Props) {
  return (
    <View style={styles.panel} accessibilityRole="alert">
      <Text style={styles.heading}>Reminder step results</Text>
      <Text style={styles.intro}>
        Each step is reported separately. Failed steps include the full JavaScript error and
        stack.
      </Text>

      {steps.map((step, index) => (
        <View key={step.stage} style={styles.step}>
          <View style={styles.stepHeader}>
            <Text style={styles.stepTitle}>
              {index + 1}. {step.label}
            </Text>
            <Text style={[styles.status, styles[step.status]]}>
              {STATUS_LABEL[step.status]}
            </Text>
          </View>

          <Text selectable style={styles.detail}>
            {step.detail}
          </Text>

          {step.error ? (
            <Text selectable style={styles.stack}>
              {step.error.name}: {step.error.message}
              {'\n'}
              {step.error.stack}
            </Text>
          ) : null}
        </View>
      ))}

      {canOpenSettings && onOpenSettings ? (
        <Pressable
          onPress={onOpenSettings}
          accessibilityRole="button"
          style={({ pressed }) => [styles.settingsButton, pressed && styles.settingsPressed]}>
          <Text style={styles.settingsLabel}>Open CueGoblin notification settings</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
  },
  heading: {
    ...typography.body,
    fontWeight: '700',
  },
  intro: {
    ...typography.hint,
  },
  step: {
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.md,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  stepTitle: {
    ...typography.body,
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  status: {
    ...typography.meta,
    letterSpacing: 0.8,
  },
  passed: {
    color: '#3D6B1E',
  },
  skipped: {
    color: colors.plumFaint,
  },
  failed: {
    color: colors.danger,
  },
  detail: {
    ...typography.hint,
    color: colors.plumMuted,
  },
  stack: {
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
    color: colors.danger,
    backgroundColor: colors.ivory,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  settingsButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.lime,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  settingsPressed: {
    backgroundColor: colors.limePressed,
  },
  settingsLabel: {
    ...typography.button,
    color: colors.plum,
  },
});
