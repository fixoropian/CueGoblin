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

import { ItemsProvider } from '@/store/items';
import { colors } from '@/theme';

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
