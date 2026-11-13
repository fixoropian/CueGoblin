import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { saveItems } from '@/storage/items';
import type { Item } from '@/types';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
  },
}));

const setItemMock = vi.mocked(AsyncStorage.setItem);

function item(text: string): Item {
  return {
    id: `item-${text}`,
    text,
    kind: 'note',
    done: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe('saveItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not let an older overlapping write overwrite newer data', async () => {
    let storedValue: string | null = null;

    setItemMock.mockImplementation(async (_key, value) => {
      if (value.includes('older')) {
        await wait(20);
      }

      storedValue = value;
    });

    await Promise.all([
      saveItems([item('older')]),
      saveItems([item('newer')]),
    ]);

    expect(setItemMock).toHaveBeenCalledTimes(2);
    expect(setItemMock).toHaveBeenNthCalledWith(
      1,
      'cuegoblin.items.v1',
      JSON.stringify([item('older')]),
    );
    expect(setItemMock).toHaveBeenNthCalledWith(
      2,
      'cuegoblin.items.v1',
      JSON.stringify([item('newer')]),
    );
    expect(storedValue).toBe(JSON.stringify([item('newer')]));
  });
});
