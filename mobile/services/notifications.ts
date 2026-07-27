import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { userApi } from './api';

// expo-notifications remote push was removed from Expo Go in SDK 53.
// We skip it entirely in Expo Go so the app loads without crashing.
// Use a development build (npx expo run:android) for full FCM support.
const isExpoGo = Constants.appOwnership === 'expo';

/**
 * Register for push notifications and send the device token to the backend.
 * No-ops gracefully in Expo Go or on simulators.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (isExpoGo) {
    console.log('[FCM] Skipping push notifications in Expo Go (not supported from SDK 53+).');
    return null;
  }

  // Dynamic imports so the module is never loaded in Expo Go
  const Device = await import('expo-device');
  if (!Device.default.isDevice) {
    console.log('[FCM] Push notifications only work on physical devices.');
    return null;
  }

  try {
    const Notifications = await import('expo-notifications');

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('trading-signals', {
        name: 'Trading Signals',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#1E40AF',
      });
    }

    const { data: token } = await Notifications.getDevicePushTokenAsync();
    if (token) {
      await userApi.updateFcmToken(token);
      console.log('[FCM] Device token registered with backend.');
    }
    return token ?? null;
  } catch (err) {
    console.warn('[FCM] Failed to register push token:', err);
    return null;
  }
}

