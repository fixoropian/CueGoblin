/**
 * Root layout: the providers that wrap every screen, and the navigator.
 *
 * Headers are hidden because both screens draw their own — that keeps the plum
 * and ivory palette consistent on iOS and Android instead of fighting each
 * platform's default header.
 */
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { configureNotificationHandler } from '@/notifications/reminders';
import { ItemsProvider } from '@/store/items';
import { colors } from '@/theme';

// Register as early as possible so a reminder that fires while the app is in the
// foreground is still shown. A failure here is retried and reported by the
// setup stage when a reminder is next saved.
try {
  configureNotificationHandler();
} catch (error) {
  console.error('[CueGoblin reminders][setup] Could not register foreground handler', error);
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ItemsProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.ivory },
          }}
        />
      </ItemsProvider>
    </SafeAreaProvider>
  );
}
