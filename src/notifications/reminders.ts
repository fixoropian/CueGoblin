/**
 * Local reminders, with every Android failure kept separate.
 * Android reminders create and verify their app notification channel before
 * checking notification permission or scheduling.
 *
 * Each stage records its own result. If one stage fails, later stages are
 * reported as skipped instead of borrowing the earlier error's message. The
 * original Error (including its stack) is kept and logged under a stage label.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export type ReminderStage =
  | 'setup'
  | 'channel'
  | 'permission-check'
  | 'permission-request'
  | 'schedule';

export type ReminderStepStatus = 'passed' | 'skipped' | 'failed';

export type ReminderErrorInfo = {
  name: string;
  message: string;
  stack: string;
};

export type ReminderStep = {
  stage: ReminderStage;
  label: string;
  status: ReminderStepStatus;
  detail: string;
  error?: ReminderErrorInfo;
};

export type ReminderAttempt = {
  ok: boolean;
  identifier?: string;
  /**
   * True when the save was abandoned because its item was deleted while the
   * reminder was being set up. Nothing is left queued for that item.
   */
  cancelled?: boolean;
  steps: ReminderStep[];
};

export const REMINDER_CHANNEL_ID = 'cuegoblin-reminders-v2';

export const REMINDER_STAGE_LABELS: Record<ReminderStage, string> = {
  setup: 'Notification setup',
  channel: 'Android notification channel',
  'permission-check': 'Permission check',
  'permission-request': 'Permission request',
  schedule: 'Scheduling',
};

export type NotificationsApi = typeof Notifications;

let handlerOwner: NotificationsApi | null = null;

function errorInfo(error: unknown): ReminderErrorInfo {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || String(error),
      stack: error.stack ?? '(no JavaScript stack was provided)',
    };
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(error);
  } catch {
    serialized = String(error);
  }

  return {
    name: 'NonErrorThrown',
    message: serialized ?? String(error),
    stack: '(a non-Error value was thrown; no stack is available)',
  };
}

function logStageError(stage: ReminderStage, error: unknown): ReminderErrorInfo {
  const info = errorInfo(error);
  console.error(
    `[CueGoblin reminders][${stage}] ${REMINDER_STAGE_LABELS[stage]} failed: ${info.name}: ${info.message}`,
  );
  console.error(`[CueGoblin reminders][${stage}] stack:\n${info.stack}`);
  if (!(error instanceof Error)) {
    console.error(`[CueGoblin reminders][${stage}] thrown value:`, error);
  }
  return info;
}

/**
 * Foreground presentation. Without this handler a local notification can be
 * delivered while the app is open without showing its heads-up banner. On
 * Android, shouldPlaySound must be true for the dropdown alert to show.
 */
export function configureNotificationHandler(api: NotificationsApi = Notifications): void {
  if (handlerOwner === api) return;

  api.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
    handleError: (notificationId, error) => {
      console.error(
        `[CueGoblin reminders][notification-handler] Could not present notification ${notificationId}`,
        error,
      );
    },
  });

  handlerOwner = api;
}

export function reminderNotificationId(itemId: string): string {
  return `cuegoblin-reminder-${itemId}`;
}

/**
 * Cancels one identifier without throwing. Cancelling is only ever a cleanup
 * step here: a failure is logged and leaves the rest of the flow alone.
 */
async function cancelQuietly(api: NotificationsApi, identifier: string): Promise<void> {
  try {
    await api.cancelScheduledNotificationAsync(identifier);
  } catch (error) {
    const info = logStageError('schedule', error);
    console.warn(
      `[CueGoblin reminders][schedule] Could not cancel reminder ${identifier}: ${info.message}`,
    );
  }
}

function isGranted(
  response: Notifications.NotificationPermissionsStatus,
  api: NotificationsApi,
): boolean {
  if (response.granted) return true;

  // On iOS a provisional authorization can still present quietly. Root
  // `granted` covers the normal Android case, but checking this avoids asking
  // again when iOS already granted provisional delivery.
  const iosStatus = response.ios?.status;
  return (
    iosStatus === api.IosAuthorizationStatus.PROVISIONAL ||
    iosStatus === api.IosAuthorizationStatus.AUTHORIZED ||
    iosStatus === api.IosAuthorizationStatus.EPHEMERAL
  );
}

function permissionDetail(response: Notifications.NotificationPermissionsStatus): string {
  return `getPermissionsAsync() returned ${JSON.stringify(response)}`;
}

/**
 * Schedules one item reminder. `reminderAt` is epoch milliseconds.
 *
 * The item text is copied into the notification body. The identifier is stable
 * per item: scheduling with it replaces that item's previous queued request, so
 * no pre-emptive cancel is needed and a failed replacement leaves the old
 * reminder in place.
 *
 * `signal` lets the caller abandon a save (for example because the item was
 * deleted while this was running). If it aborts before the native schedule
 * call, nothing is queued; if it aborts during that call, the request that just
 * landed is removed again.
 */
export async function scheduleItemReminder(options: {
  itemId: string;
  text: string;
  reminderAt: number;
  now?: number;
  platform?: string;
  api?: NotificationsApi;
  signal?: AbortSignal;
}): Promise<ReminderAttempt> {
  const {
    itemId,
    text,
    reminderAt,
    now = Date.now(),
    platform = Platform.OS,
    api = Notifications,
    signal,
  } = options;

  const steps: ReminderStep[] = [];
  const add = (step: ReminderStep) => steps.push(step);
  const skip = (stage: ReminderStage, reason: string) =>
    add({
      stage,
      label: REMINDER_STAGE_LABELS[stage],
      status: 'skipped',
      detail: `Not run: ${reason}`,
    });
  const fail = (stage: ReminderStage, error: unknown, detail: string) => {
    const info = logStageError(stage, error);
    add({
      stage,
      label: REMINDER_STAGE_LABELS[stage],
      status: 'failed',
      detail,
      error: info,
    });
  };

  // 1. Module/setup. Channel creation and lookup get their own result below.
  try {
    if (platform === 'web') {
      throw new Error('Local reminders are not available in the web build.');
    }
    if (
      typeof api.scheduleNotificationAsync !== 'function' ||
      typeof api.getPermissionsAsync !== 'function'
    ) {
      throw new Error(
        'expo-notifications is unavailable. The native module is missing from this runtime.',
      );
    }

    configureNotificationHandler(api);
    add({
      stage: 'setup',
      label: REMINDER_STAGE_LABELS.setup,
      status: 'passed',
      detail: `expo-notifications loaded on ${platform}; foreground handler registered (banner, list and sound enabled).`,
    });
  } catch (error) {
    fail(
      'setup',
      error,
      'Notification setup failed. No permission or schedule call was made.',
    );
    skip('channel', 'notification setup failed');
    skip('permission-check', 'notification setup failed');
    skip('permission-request', 'notification setup failed');
    skip('schedule', 'notification setup failed');
    return { ok: false, steps };
  }

  // 2. Channel. Create and read back the app-owned channel before the Android
  // permission check, then schedule reminders onto this channel explicitly.
  if (platform !== 'android') {
    skip('channel', `Android-only step; this runtime is ${platform}`);
  } else {
    try {
      await api.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
        name: 'CueGoblin reminders',
        importance: api.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
      const channel = await api.getNotificationChannelAsync(REMINDER_CHANNEL_ID);
      if (!channel) {
        throw new Error(
          `getNotificationChannelAsync("${REMINDER_CHANNEL_ID}") returned no channel after creation.`,
        );
      }
      add({
        stage: 'channel',
        label: REMINDER_STAGE_LABELS.channel,
        status: 'passed',
        detail: `Created and read back Android channel "${REMINDER_CHANNEL_ID}" (importance=${channel.importance}).`,
      });
    } catch (error) {
      fail(
        'channel',
        error,
        `Could not create and verify Android channel "${REMINDER_CHANNEL_ID}".`,
      );
      skip('permission-check', 'Android notification channel setup failed');
      skip('permission-request', 'Android notification channel setup failed');
      skip('schedule', 'Android notification channel setup failed');
      return { ok: false, steps };
    }
  }

  // 3. Permission check. Keep the original response; `canAskAgain` is what tells
  // us whether the system can show the prompt again.
  let permissions: Notifications.NotificationPermissionsStatus;
  try {
    permissions = await api.getPermissionsAsync();
    add({
      stage: 'permission-check',
      label: REMINDER_STAGE_LABELS['permission-check'],
      status: 'passed',
      detail: permissionDetail(permissions),
    });
  } catch (error) {
    fail('permission-check', error, 'Could not read the notification permission status.');
    skip('permission-request', 'permission check failed');
    skip('schedule', 'permission check failed');
    return { ok: false, steps };
  }

  // 4. Permission request. If this app's permission is already allowed this is
  // a deliberate no-op, not a warning. If it is blocked, explain that directly.
  if (isGranted(permissions, api)) {
    add({
      stage: 'permission-request',
      label: REMINDER_STAGE_LABELS['permission-request'],
      status: 'skipped',
      detail: 'Not needed: notifications are already granted for CueGoblin on this phone.',
    });
  } else if (!permissions.canAskAgain) {
    const blocked = new Error(
      'Notifications are blocked for CueGoblin and Android will not show the permission prompt again. Open Settings > Apps > CueGoblin > Notifications and allow notifications.',
    );
    fail(
      'permission-request',
      blocked,
      `Permission is denied and canAskAgain=false. ${permissionDetail(permissions)}`,
    );
    skip('schedule', 'notification permission is blocked');
    return { ok: false, steps };
  } else {
    try {
      const requested = await api.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: false, allowSound: true },
      });

      if (!isGranted(requested, api)) {
        const denied = new Error(
          `The permission request completed, but notifications are still not granted (status=${requested.status}, canAskAgain=${requested.canAskAgain}).`,
        );
        fail(
          'permission-request',
          denied,
          `requestPermissionsAsync() returned ${JSON.stringify(requested)}`,
        );
        skip('schedule', 'notification permission was not granted');
        return { ok: false, steps };
      }

      add({
        stage: 'permission-request',
        label: REMINDER_STAGE_LABELS['permission-request'],
        status: 'passed',
        detail: `requestPermissionsAsync() returned ${JSON.stringify(requested)}`,
      });
    } catch (error) {
      fail(
        'permission-request',
        error,
        'Calling requestPermissionsAsync() threw. The permission prompt was not requested successfully.',
      );
      skip('schedule', 'permission request threw');
      return { ok: false, steps };
    }
  }

  // 5. Schedule. Date validation and native scheduling belong to this one stage.
  const identifier = reminderNotificationId(itemId);
  const abandon = (detail: string): ReminderAttempt => {
    add({
      stage: 'schedule',
      label: REMINDER_STAGE_LABELS.schedule,
      status: 'skipped',
      detail,
    });
    return { ok: false, cancelled: true, steps };
  };

  try {
    if (!Number.isFinite(reminderAt) || reminderAt <= 0) {
      throw new RangeError(`Invalid reminder timestamp: ${String(reminderAt)}`);
    }
    if (reminderAt <= now) {
      throw new RangeError(
        `The reminder date ${new Date(reminderAt).toISOString()} is in the past (now ${new Date(now).toISOString()}).`,
      );
    }

    if (signal?.aborted) {
      return abandon(
        'Not scheduled: the item was deleted while this save was still in progress.',
      );
    }

    // Scheduling with the item's stable identifier replaces that item's
    // previous request in the OS queue, so the old reminder is only gone once
    // the replacement exists. There is deliberately no cancel-before-schedule:
    // if this call fails, the reminder that was already queued stays put.
    const scheduledId = await api.scheduleNotificationAsync({
      identifier,
      content: {
        title: 'CueGoblin reminder',
        body: text.trim() || 'Your saved reminder',
        sound: 'default',
        data: { itemId, type: 'cuegoblin-reminder' },
      },
      trigger: {
        type: api.SchedulableTriggerInputTypes.DATE,
        date: new Date(reminderAt),
        ...(platform === 'android' ? { channelId: REMINDER_CHANNEL_ID } : {}),
      },
    });

    // Deleting the item can happen while the native call is in flight. Remove
    // the request that just landed rather than leave an alert for a gone item.
    if (signal?.aborted) {
      await cancelQuietly(api, scheduledId);
      return abandon(
        'Scheduled and then removed again: the item was deleted while this save was still in progress.',
      );
    }

    const all = await api.getAllScheduledNotificationsAsync();
    const nativeRequest = all.find((request) => request.identifier === scheduledId);
    if (!nativeRequest) {
      throw new Error(
        `scheduleNotificationAsync resolved with "${scheduledId}", but that identifier was not present in getAllScheduledNotificationsAsync().`,
      );
    }

    // The replacement is confirmed queued, so a request left under a different
    // identifier for this item can safely go. Nothing is cancelled before this
    // point, which is what keeps a failed replacement from dropping a working
    // reminder.
    if (scheduledId !== identifier) {
      await cancelQuietly(api, identifier);
    }

    const channelLabel =
      platform === 'android' ? `Android channel "${REMINDER_CHANNEL_ID}"` : 'the platform default';

    add({
      stage: 'schedule',
      label: REMINDER_STAGE_LABELS.schedule,
      status: 'passed',
      detail: `Scheduled "${scheduledId}" for ${new Date(reminderAt).toISOString()} on ${channelLabel}. It is present in the OS queue.`,
    });

    return { ok: true, identifier: scheduledId, steps };
  } catch (error) {
    fail(
      'schedule',
      error,
      `Could not schedule the reminder for ${new Date(reminderAt).toISOString()}.`,
    );
    return { ok: false, steps };
  }
}

/**
 * Removes a queued reminder when its item is deleted or its reminder is turned
 * off. Cancelling an identifier that is not queued is a no-op in Expo.
 */
export async function cancelItemReminder(
  itemId: string,
  api: NotificationsApi = Notifications,
): Promise<void> {
  await cancelQuietly(api, reminderNotificationId(itemId));
}
