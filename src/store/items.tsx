/**
 * The app's single source of truth for items, held in memory and saved on every
 * change.
 *
 * Why Context + useReducer instead of Redux/Zustand? At this size a dependency
 * would add more concepts than it removes. One reducer shows exactly which
 * changes are possible, and the provider is the only place that talks to storage.
 *
 * Two rules protect your data here:
 *
 * 1. Nothing is written to storage until the first read has SUCCEEDED. If the
 *    read failed, we do not know what is on disk, so we must not overwrite it.
 * 2. Capture is disabled until that successful read. Otherwise you could add an
 *    item while the app was still loading, and the first write would save a
 *    list that was missing everything it was still on its way to load.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { createId } from '@/lib/id';
import { loadItems, saveItems } from '@/storage/items';
import type { Item, ItemKind } from '@/types';

/** Fields an edit screen is allowed to change. */
export type ItemChanges = Partial<Pick<Item, 'text' | 'kind' | 'done'>>;

/**
 * Where the app is in the read-then-write cycle.
 *
 * - `loading`: the first read is in flight. No writes, no capture.
 * - `ready`: the read succeeded. Changes are saved automatically.
 * - `failed`: the read failed. We do not know what is on disk, so we refuse to
 *   write until the user retries and it succeeds.
 */
export type LoadStatus = 'loading' | 'ready' | 'failed';

type State = {
  items: Item[];
  loadStatus: LoadStatus;
  /** Set when the read failed; shown to the user with a retry button. */
  loadError: string | null;
  /** Set when the last write failed; shown to the user. */
  saveError: string | null;
};

type Action =
  | { type: 'loadStarted' }
  | { type: 'loadSucceeded'; items: Item[] }
  | { type: 'loadFailed'; message: string }
  | { type: 'saveFailed'; message: string }
  | { type: 'saveSucceeded' }
  | { type: 'added'; item: Item }
  | { type: 'updated'; id: string; changes: ItemChanges; updatedAt: number }
  | { type: 'toggled'; id: string; updatedAt: number }
  | { type: 'removed'; id: string };

const INITIAL_STATE: State = {
  items: [],
  loadStatus: 'loading',
  loadError: null,
  saveError: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loadStarted':
      return { ...state, loadStatus: 'loading', loadError: null };

    case 'loadSucceeded':
      return { ...state, items: action.items, loadStatus: 'ready', loadError: null };

    case 'loadFailed':
      // Keep whatever is in memory, but mark the app as not ready. We must not
      // save while the status is 'failed'.
      return { ...state, loadStatus: 'failed', loadError: action.message };

    case 'saveFailed':
      return { ...state, saveError: action.message };

    case 'saveSucceeded':
      return { ...state, saveError: null };

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
  /** True only once the saved list has been read successfully. */
  isReady: boolean;
  /** True while the first read is still running. */
  isLoading: boolean;
  loadError: string | null;
  saveError: string | null;
  /** Re-reads the saved list. Used by the "Try again" button. */
  retryLoad: () => void;
  /** Saves the current list again. Used by the "Try again" button after a failed write. */
  retrySave: () => void;
  addItem: (text: string, kind: ItemKind) => void;
  updateItem: (id: string, changes: ItemChanges) => void;
  toggleItemDone: (id: string) => void;
  removeItem: (id: string) => void;
};

const ItemsContext = createContext<ItemsContextValue | null>(null);

export function ItemsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  // A counter drives retries: bumping it makes the load effect run again.
  const [loadAttempt, setLoadAttempt] = useState(0);
  const retryLoad = useCallback(() => setLoadAttempt((value) => value + 1), []);

  /**
   * The list exactly as it was read from storage. We use it to recognise "the
   * list has not changed since we loaded it", so we do not write the same data
   * straight back to disk the moment the app opens.
   */
  const loadedSnapshotRef = useRef<Item[] | null>(null);

  // Read on startup and after every retry.
  useEffect(() => {
    // `cancelled` avoids updating after unmount (and a React warning in dev).
    let cancelled = false;

    dispatch({ type: 'loadStarted' });

    void loadItems().then((result) => {
      if (cancelled) return;

      if (result.ok) {
        // Remember this exact array. If the list still looks like this later,
        // there is nothing new to write.
        loadedSnapshotRef.current = result.items;
        dispatch({ type: 'loadSucceeded', items: result.items });
      } else {
        // A failed read tells us nothing about what is on disk. Forgetting the
        // snapshot means we will not write until a read succeeds.
        loadedSnapshotRef.current = null;
        dispatch({ type: 'loadFailed', message: result.message });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);


  // Persist after the list changes — but only once the read has succeeded.
  //
  // The `loadStatus` check is the important part. While loading (or after a
  // failed read) we have no idea what is on disk, so writing would risk
  // replacing real data with a partial or empty list.
  useEffect(() => {
    if (state.loadStatus !== 'ready') return;

    // Nothing changed since we read it: there is nothing to write.
    if (state.items === loadedSnapshotRef.current) return;

    let cancelled = false;

    void saveItems(state.items).then((result) => {
      if (cancelled) return;

      if (result.ok) {
        // This is now the version on disk, so do not write it again.
        loadedSnapshotRef.current = state.items;
        dispatch({ type: 'saveSucceeded' });
      } else {
        dispatch({ type: 'saveFailed', message: result.message });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [state.items, state.loadStatus]);

  // Saving again after a failed write: writes exactly what is in memory now.
  const retrySave = useCallback(() => {
    const items = state.items;
    void saveItems(items).then((result) => {
      if (result.ok) {
        loadedSnapshotRef.current = items;
        dispatch({ type: 'saveSucceeded' });
      } else {
        dispatch({ type: 'saveFailed', message: result.message });
      }
    });
  }, [state.items]);

  const actions = useMemo(
    () => ({
      addItem: (text: string, kind: ItemKind) => {
        // Guard: never add before the list has loaded, because the first save
        // would then write a list that is missing the saved items.
        if (state.loadStatus !== 'ready') return;

        const now = Date.now();
        dispatch({
          type: 'added',
          item: { id: createId(), text, kind, done: false, createdAt: now, updatedAt: now },
        });
      },
      updateItem: (id: string, changes: ItemChanges) => {
        if (state.loadStatus !== 'ready') return;
        dispatch({ type: 'updated', id, changes, updatedAt: Date.now() });
      },
      toggleItemDone: (id: string) => {
        if (state.loadStatus !== 'ready') return;
        dispatch({ type: 'toggled', id, updatedAt: Date.now() });
      },
      removeItem: (id: string) => {
        if (state.loadStatus !== 'ready') return;
        dispatch({ type: 'removed', id });
      },
    }),
    [state.loadStatus],
  );

  const value = useMemo(
    () => ({
      items: state.items,
      isReady: state.loadStatus === 'ready',
      isLoading: state.loadStatus === 'loading',
      loadError: state.loadError,
      saveError: state.saveError,
      retryLoad,
      retrySave,
      ...actions,
    }),
    [state.items, state.loadStatus, state.loadError, state.saveError, retryLoad, retrySave, actions],
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
