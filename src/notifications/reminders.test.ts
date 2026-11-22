import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationPermissionsStatus, NotificationRequest } from 'expo-notifications';
import {
  scheduleItemReminder,
  type NotificationsApi,
} from '@/notifications/reminders';

vi.mock('expo-notifications', () => ({}));

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

const NOW = Date.UTC(2026, 10, 19, 10, 0, 0);
const REMINDER_AT = NOW + 60 * 60 * 1000;

function permissions(
  overrides: Partial<NotificationPermissionsStatus> = {},
): NotificationPermissionsStatus {
  return {
    granted: true,
    status: 'granted',
    canAskAgain: true,
    expires: 'never',
    ...overrides,
  } as NotificationPermissionsStatus;
}

function createApi(overrides: Record<string, unknown> = {}) {
  const scheduled = new Map<string, NotificationRequest>();
  const setNotificationHandler = vi.fn();
  const setNotificationChannelAsync = vi.fn(
    async (_channelId: string, _options: Record<string, unknown>) => null,
  );
  const getNotificationChannelAsync = vi.fn(async (id: string) => ({ id, importance: 7 }));
  const getPermissionsAsync = vi.fn(async () => permissions());
  const requestPermissionsAsync = vi.fn(async () => permissions());
  const cancelScheduledNotificationAsync = vi.fn(async (identifier: string) => {
    scheduled.delete(identifier);
  });
  const scheduleNotificationAsync = vi.fn(async (request: { identifier?: string }) => {
    const identifier = request.identifier ?? 'generated';
    scheduled.set(identifier, request as unknown as NotificationRequest);
    return identifier;
  });
  const getAllScheduledNotificationsAsync = vi.fn(async () =>
    Array.from(scheduled.values()),
  );

  const mock = {
    AndroidImportance: { MAX: 7 },
    IosAuthorizationStatus: {
      NOT_DETERMINED: 0,
      DENIED: 1,
      AUTHORIZED: 2,
      PROVISIONAL: 3,
      EPHEMERAL: 4,
    },
    SchedulableTriggerInputTypes: { DATE: 'date' },
    setNotificationHandler,
    setNotificationChannelAsync,
    getNotificationChannelAsync,
    getPermissionsAsync,
    requestPermissionsAsync,
    cancelScheduledNotificationAsync,
    scheduleNotificationAsync,
    getAllScheduledNotificationsAsync,
    ...overrides,
  } as unknown as NotificationsApi;

  return {
    api: mock,
    scheduled,
    setNotificationHandler,
    setNotificationChannelAsync,
    getNotificationChannelAsync,
    getPermissionsAsync: mock.getPermissionsAsync,
    requestPermissionsAsync: mock.requestPermissionsAsync,
    cancelScheduledNotificationAsync: mock.cancelScheduledNotificationAsync,
    scheduleNotificationAsync: mock.scheduleNotificationAsync,
    getAllScheduledNotificationsAsync: mock.getAllScheduledNotificationsAsync,
    mockApi: {
      setNotificationChannelAsync,
      getNotificationChannelAsync,
      getPermissionsAsync: mock.getPermissionsAsync as ReturnType<typeof vi.fn>,
      requestPermissionsAsync: mock.requestPermissionsAsync as ReturnType<typeof vi.fn>,
      cancelScheduledNotificationAsync: mock.cancelScheduledNotificationAsync as ReturnType<typeof vi.fn>,
      scheduleNotificationAsync: mock.scheduleNotificationAsync as ReturnType<typeof vi.fn>,
      getAllScheduledNotificationsAsync: mock.getAllScheduledNotificationsAsync as ReturnType<typeof vi.fn>,
    },
  };
}

const input = {
  itemId: 'item-123',
  text: 'Call the dentist',
  reminderAt: REMINDER_AT,
  now: NOW,
  platform: 'android',
};

describe('scheduleItemReminder', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates and reads the Android channel before scheduling reminders onto it', async () => {
    const harness = createApi();

    const result = await scheduleItemReminder({ ...input, api: harness.api });

    expect(result.ok).toBe(true);
    expect(result.steps[1]).toMatchObject({
      stage: 'channel',
      status: 'passed',
      detail: expect.stringContaining('Created and read back Android channel'),
    });
    expect(result.steps[2]).toMatchObject({ stage: 'permission-check', status: 'passed' });
    expect(result.steps[4]).toMatchObject({ stage: 'schedule', status: 'passed' });
    expect(result.steps[4].detail).toContain('present in the OS queue');

    expect(harness.mockApi.setNotificationChannelAsync).toHaveBeenCalledWith(
      'cuegoblin-reminders-v2',
      expect.objectContaining({ name: 'CueGoblin reminders', importance: 7 }),
    );
    expect(harness.mockApi.getNotificationChannelAsync).toHaveBeenCalledWith('cuegoblin-reminders-v2');
    expect(harness.mockApi.getPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(harness.mockApi.getAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
    const request = harness.mockApi.scheduleNotificationAsync.mock.calls[0][0] as { trigger: { channelId?: string } };
    expect(request.trigger.channelId).toBe('cuegoblin-reminders-v2');
  });

  it('requests permission when undetermined and records the exact response', async () => {
    const harness = createApi({
      getPermissionsAsync: vi.fn(async () =>
        permissions({
          granted: false,
          status: 'undetermined' as NotificationPermissionsStatus['status'],
        }),
      ),
    });

    const result = await scheduleItemReminder({ ...input, api: harness.api });

    expect(result.ok).toBe(true);
    expect(harness.mockApi.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(result.steps[3].status).toBe('passed');
    expect(result.steps[3].detail).toContain('"granted":true');
  });

  it('reports setup failure separately and skips dependent steps', async () => {
    const harness = createApi({
      setNotificationHandler: vi.fn(() => {
        throw new Error('handler registration exploded');
      }),
    });

    const result = await scheduleItemReminder({ ...input, api: harness.api });

    expect(result.ok).toBe(false);
    expect(result.steps[0]).toMatchObject({
      stage: 'setup',
      status: 'failed',
      error: { message: 'handler registration exploded' },
    });
    expect(result.steps[0].error?.stack).toContain('handler registration exploded');
    expect(result.steps.slice(1).every((step) => step.status === 'skipped')).toBe(true);
    expect(harness.mockApi.getPermissionsAsync).not.toHaveBeenCalled();
    expect(harness.mockApi.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('reports a successful schedule as queued, not as delivered', async () => {
    const harness = createApi();

    const result = await scheduleItemReminder({ ...input, api: harness.api });

    expect(result.ok).toBe(true);
    for (const step of result.steps.slice(0, 4)) {
      expect(step.status).not.toBe('failed');
    }
    expect(result.steps[4]).toMatchObject({
      stage: 'schedule',
      status: 'passed',
    });
    expect(result.steps[4].detail).not.toContain('delivered');
    expect(result.identifier).toMatch(/^cuegoblin-reminder-/);
    expect(result.steps[4].detail).toMatch(/present in the OS queue/);
  });

  it('reports a permission-check exception without folding it into another warning', async () => {
    const harness = createApi({
      getPermissionsAsync: vi.fn(async () => {
        throw new Error('permission bridge exploded');
      }),
    });

    const result = await scheduleItemReminder({ ...input, api: harness.api });

    expect(result.steps[0].status).toBe('passed');
    expect(result.steps[1].status).toBe('passed');
    expect(result.steps[2]).toMatchObject({
      stage: 'permission-check',
      status: 'failed',
      error: { message: 'permission bridge exploded' },
    });
    expect(result.steps[3].status).toBe('skipped');
    expect(result.steps[4].status).toBe('skipped');
    expect(harness.mockApi.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('reports a permission-request exception and keeps scheduling skipped', async () => {
    const harness = createApi({
      getPermissionsAsync: vi.fn(async () =>
        permissions({
          granted: false,
          status: 'undetermined' as NotificationPermissionsStatus['status'],
        }),
      ),
      requestPermissionsAsync: vi.fn(async () => {
        throw new Error('requestPermissionsAsync failed in Expo Go');
      }),
    });

    const result = await scheduleItemReminder({ ...input, api: harness.api });

    expect(result.steps[3]).toMatchObject({
      stage: 'permission-request',
      status: 'failed',
      error: { message: 'requestPermissionsAsync failed in Expo Go' },
    });
    expect(result.steps[3].error?.stack).toContain('requestPermissionsAsync failed in Expo Go');
    expect(result.steps[4].status).toBe('skipped');
    expect(harness.mockApi.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('explains a blocked permission instead of claiming the prompt failed', async () => {
    const harness = createApi({
      getPermissionsAsync: vi.fn(async () =>
        permissions({
          granted: false,
          status: 'denied' as NotificationPermissionsStatus['status'],
          canAskAgain: false,
        }),
      ),
    });

    const result = await scheduleItemReminder({ ...input, api: harness.api });

    expect(result.steps[3].status).toBe('failed');
    expect(result.steps[3].detail).toContain('canAskAgain=false');
    expect(result.steps[3].error?.message).toContain('Open Settings > Apps > CueGoblin');
    expect(harness.mockApi.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('reports a scheduling exception as its own stage', async () => {
    const harness = createApi({
      scheduleNotificationAsync: vi.fn(async () => {
        throw new Error('AlarmManager exploded');
      }),
    });

    const result = await scheduleItemReminder({ ...input, api: harness.api });

    for (const step of result.steps.slice(0, 4)) {
      expect(step.status).not.toBe('failed');
    }
    expect(result.steps[4]).toMatchObject({
      stage: 'schedule',
      status: 'failed',
      error: { message: 'AlarmManager exploded' },
    });
    expect(result.steps[4].error?.stack).toContain('AlarmManager exploded');
  });

  it('rejects a reminder in the past without scheduling it', async () => {
    const harness = createApi();

    const result = await scheduleItemReminder({
      ...input,
      reminderAt: NOW - 1000,
      api: harness.api,
    });

    expect(result.ok).toBe(false);
    expect(result.steps[4].status).toBe('failed');
    expect(result.steps[4].error?.message).toContain('is in the past');
    expect(harness.mockApi.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});
