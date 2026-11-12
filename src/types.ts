/**
 * The whole data model for milestone one is one small type.
 *
 * `done` only means something for tasks and shopping items; notes simply keep
 * it false. We store it on every item anyway so a note can be turned into a task
 * later without a data migration.
 */
export const ITEM_KINDS = ['note', 'task', 'shopping'] as const;

export type ItemKind = (typeof ITEM_KINDS)[number];

export type Item = {
  /** Locally generated, stable for the life of the item. */
  id: string;
  text: string;
  kind: ItemKind;
  done: boolean;
  /** Epoch milliseconds. Numbers sort easily and survive JSON. */
  createdAt: number;
  updatedAt: number;
};

export const KIND_LABEL: Record<ItemKind, string> = {
  note: 'Note',
  task: 'Task',
  shopping: 'Shopping',
};

export const KIND_LABEL_PLURAL: Record<ItemKind, string> = {
  note: 'Notes',
  task: 'Tasks',
  shopping: 'Shopping',
};

export function isItemKind(value: unknown): value is ItemKind {
  return typeof value === 'string' && (ITEM_KINDS as readonly string[]).includes(value);
}

/**
 * Data on disk came from an older version of the app (or was tampered with), so
 * every field is checked before we trust it. One bad record is dropped instead
 * of crashing the list.
 */
export function isItem(value: unknown): value is Item {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.text === 'string' &&
    isItemKind(candidate.kind) &&
    typeof candidate.done === 'boolean' &&
    typeof candidate.createdAt === 'number' &&
    typeof candidate.updatedAt === 'number'
  );
}
