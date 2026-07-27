import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { userApi } from './api';

// Configure foreground notification behaviour
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Register for push notifications and send the device token to the backend.
 * Safe to call multiple times — skips silently on simulator / if permissions denied.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('[FCM] Push notifications only work on physical devices.');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[FCM] Notification permission denied.');
    return null;
  }

  // Android notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('trading-signals', {
      name: 'Trading Signals',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1E40AF',
    });
  }

  try {
    // getDevicePushTokenAsync returns the native FCM token (Android) or APNs token (iOS)
    const { data: deviceToken } = await Notifications.getDevicePushTokenAsync();
    if (deviceToken) {
      await userApi.updateFcmToken(deviceToken);
      console.log('[FCM] Device token registered with backend.');
    }
    return deviceToken ?? null;
  } catch (err) {
    // Non-fatal — app works without FCM
    console.warn('[FCM] Failed to get device push token:', err);
    return null;
  }
}
