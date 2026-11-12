/**
 * Home screen: capture at the top, filter chips, then everything you saved.
 *
 * Filtering happens in memory on every render. With a personal list of hundreds
 * of items that is instant, and it avoids inventing a query layer before it is
 * needed.
 */
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CaptureBar } from '@/components/CaptureBar';
import { EmptyState } from '@/components/EmptyState';
import { ItemRow } from '@/components/ItemRow';
import { useItems } from '@/store/items';
import { colors, radius, spacing, typography } from '@/theme';
import { ITEM_KINDS, KIND_LABEL_PLURAL, type ItemKind } from '@/types';

type Filter = 'all' | ItemKind;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  ...ITEM_KINDS.map((kind) => ({ value: kind, label: KIND_LABEL_PLURAL[kind] })),
];

const EMPTY_COPY: Record<Filter, { title: string; body: string }> = {
  all: {
    title: 'Nothing here yet',
    body: 'Type above and tap Add. A thought, a task, a loaf of bread — anything.',
  },
  note: {
    title: 'No notes yet',
    body: 'Pick “Note” when you just want to keep a thought.',
  },
  task: {
    title: 'No tasks yet',
    body: 'Pick “Task” for something you want to get done.',
  },
  shopping: {
    title: 'Shopping list is empty',
    body: 'Pick “Shopping” and add things to grab next time you are out.',
  },
};

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { items, hydrated, addItem, toggleItemDone } = useItems();
  const [filter, setFilter] = useState<Filter>('all');

  const visibleItems = useMemo(
    () => (filter === 'all' ? items : items.filter((item) => item.kind === filter)),
    [items, filter],
  );

  const emptyCopy = EMPTY_COPY[filter];

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        data={visibleItems}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
        ]}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={
          <View style={styles.header}>
            <View>
              <Text style={styles.brand}>CueGoblin</Text>
              <Text style={styles.tagline}>Out of your head, into here.</Text>
            </View>

            <CaptureBar onAdd={addItem} />

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filters}>
              {FILTERS.map(({ value, label }) => {
                const selected = value === filter;
                return (
                  <Pressable
                    key={value}
                    onPress={() => setFilter(value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={[styles.filter, selected && styles.filterSelected]}>
                    <Text style={[styles.filterLabel, selected && styles.filterLabelSelected]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        }
        renderItem={({ item }) => (
          <ItemRow
            item={item}
            onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })}
            onToggle={() => toggleItemDone(item.id)}
          />
        )}
        ListEmptyComponent={
          // Avoid flashing "nothing here" while storage is still being read.
          // `undefined` (not null) is what FlatList accepts for "render nothing".
          hydrated ? <EmptyState title={emptyCopy.title} body={emptyCopy.body} /> : undefined
        }
      />
    </KeyboardAvoidingView>
  );
}

function Separator() {
  return <View style={{ height: spacing.sm }} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.ivory,
  },
  content: {
    paddingHorizontal: spacing.lg,
    flexGrow: 1,
  },
  header: {
    gap: spacing.lg,
    paddingBottom: spacing.lg,
  },
  brand: {
    ...typography.display,
  },
  tagline: {
    ...typography.hint,
    marginTop: 2,
  },
  filters: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  filter: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'transparent',
  },
  filterSelected: {
    backgroundColor: colors.plum,
    borderColor: colors.plum,
  },
  filterLabel: {
    ...typography.meta,
    color: colors.plumMuted,
  },
  filterLabelSelected: {
    color: colors.ivory,
  },
});
