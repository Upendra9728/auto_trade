import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { PaperProvider, MD3LightTheme } from 'react-native-paper';
import { AuthProvider } from '../contexts/AuthContext';
import { UpdateProvider } from '../contexts/UpdateContext';
import UpdateBadge from '../components/UpdateBadge';
import UpdateModal from '../components/UpdateModal';
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
    setupNotifications();

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, string>;
      if (data?.type === 'SIGNAL') {
        router.push('/(user)/');
      }
    });

    return () => sub.remove();
  }, []);

  return (
    <PaperProvider theme={theme}>
      <UpdateProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <View style={{ flex: 1 }}>
            <Stack screenOptions={{ headerShown: false }} />
            <UpdateBadge />
            <UpdateModal />
          </View>
        </AuthProvider>
      </UpdateProvider>
    </PaperProvider>
  );
}
