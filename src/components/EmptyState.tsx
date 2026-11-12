/**
 * Shown when a filter has nothing in it. Copy changes per filter so the empty
 * screen still feels like the app is talking to you, not just blank.
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme';

type Props = {
  title: string;
  body: string;
};

export function EmptyState({ title, body }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.blob}>
        <View style={styles.blobDot} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  blob: {
    width: 60,
    height: 60,
    borderRadius: radius.lg,
    backgroundColor: colors.limeWash,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    transform: [{ rotate: '-8deg' }],
  },
  blobDot: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.lime,
  },
  title: {
    ...typography.title,
    fontSize: 19,
    textAlign: 'center',
  },
  body: {
    ...typography.hint,
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 280,
  },
});
