import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PaperProvider, MD3LightTheme } from 'react-native-paper';
import { AuthProvider } from '../contexts/AuthContext';
import { Colors } from '../constants/theme';
import { setupNotifications } from '../services/notifications';

const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: Colors.primary,
    secondary: Colors.primaryLight,
    background: Colors.background,
    surface: Colors.surface,
  },
};

export default function RootLayout() {
  useEffect(() => {
    // Set up foreground handler + Android channel on every app start (including cold start).
    setupNotifications();

    // Listen for notification taps — navigate to the signals screen.
    let sub: { remove: () => void } | null = null;
    (async () => {
      try {
        const Notifications = await import('expo-notifications');
        sub = Notifications.addNotificationResponseReceivedListener((response) => {
          const data = response.notification.request.content.data as Record<string, string>;
          if (data?.type === 'SIGNAL') {
            // Navigate to user signals list when the user taps the notification.
            router.push('/(user)/');
          }
        });
      } catch {}
    })();

    return () => { sub?.remove(); };
  }, []);

  return (
    <PaperProvider theme={theme}>
      <AuthProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
    </PaperProvider>
  );
}
