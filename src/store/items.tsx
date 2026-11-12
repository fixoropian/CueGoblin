/**
 * The app's single source of truth for items, held in memory and saved on every
 * change.
 *
 * Why Context + useReducer instead of Redux/Zustand? At this size a dependency
 * would add more concepts than it removes. One reducer shows exactly which
 * changes are possible, and the provider is the only place that talks to storage.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';

import { createId } from '@/lib/id';
import { loadItems, saveItems } from '@/storage/items';
import type { Item, ItemKind } from '@/types';

/** Fields an edit screen is allowed to change. */
export type ItemChanges = Partial<Pick<Item, 'text' | 'kind' | 'done'>>;

type State = {
  items: Item[];
  /** False until the first read from storage finishes. */
  hydrated: boolean;
};

type Action =
  | { type: 'hydrated'; items: Item[] }
  | { type: 'added'; item: Item }
  | { type: 'updated'; id: string; changes: ItemChanges; updatedAt: number }
  | { type: 'toggled'; id: string; updatedAt: number }
  | { type: 'removed'; id: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'hydrated':
      return { items: action.items, hydrated: true };

    case 'added':
      // Newest first: a fresh capture should appear at the top of the list.
      return { ...state, items: [action.item, ...state.items] };

    case 'updated':
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id
            ? { ...item, ...action.changes, updatedAt: action.updatedAt }
            : item,
        ),
      };

    case 'toggled':
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id
            ? { ...item, done: !item.done, updatedAt: action.updatedAt }
            : item,
        ),
      };

    case 'removed':
      return { ...state, items: state.items.filter((item) => item.id !== action.id) };

    default:
      return state;
  }
}

type ItemsContextValue = {
  items: Item[];
  hydrated: boolean;
  addItem: (text: string, kind: ItemKind) => void;
  updateItem: (id: string, changes: ItemChanges) => void;
  toggleItemDone: (id: string) => void;
  removeItem: (id: string) => void;
};

const ItemsContext = createContext<ItemsContextValue | null>(null);

export function ItemsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { items: [], hydrated: false });

  // Read once on startup. The `cancelled` flag avoids updating after unmount
  // (and avoids a React warning in development).
  useEffect(() => {
    let cancelled = false;

    void loadItems().then((items) => {
      if (!cancelled) dispatch({ type: 'hydrated', items });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Persist after hydration only — otherwise the initial empty list would
  // overwrite real saved items before they finish loading.
  useEffect(() => {
    if (!state.hydrated) return;
    void saveItems(state.items);
  }, [state.items, state.hydrated]);

  const actions = useMemo(
    () => ({
      addItem: (text: string, kind: ItemKind) => {
        const now = Date.now();
        dispatch({
          type: 'added',
          item: { id: createId(), text, kind, done: false, createdAt: now, updatedAt: now },
        });
      },
      updateItem: (id: string, changes: ItemChanges) => {
        dispatch({ type: 'updated', id, changes, updatedAt: Date.now() });
      },
      toggleItemDone: (id: string) => {
        dispatch({ type: 'toggled', id, updatedAt: Date.now() });
      },
      removeItem: (id: string) => {
        dispatch({ type: 'removed', id });
      },
    }),
    [],
  );

  const value = useMemo(
    () => ({ items: state.items, hydrated: state.hydrated, ...actions }),
    [state.items, state.hydrated, actions],
  );

  return <ItemsContext.Provider value={value}>{children}</ItemsContext.Provider>;
}

export function useItems(): ItemsContextValue {
  const context = useContext(ItemsContext);
  if (!context) {
    throw new Error('useItems must be used inside <ItemsProvider>');
  }
  return context;
}
