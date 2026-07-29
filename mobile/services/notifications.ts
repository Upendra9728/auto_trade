import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { userApi } from './api';

// expo-notifications remote push was removed from Expo Go in SDK 53.
// We skip it entirely in Expo Go so the app loads without crashing.
const isExpoGo = Constants.appOwnership === 'expo';

/**
 * Call once at app startup (in _layout.tsx) to:
 *  - Set the foreground notification handler (show alert + sound when app is open)
 *  - Create the Android notification channel so background FCM messages land correctly
 */
export async function setupNotifications(): Promise<void> {
  if (isExpoGo) return;

  try {
    // Controls how notifications look when the app is in the FOREGROUND.
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });

    // Android 8+ requires a channel. Must match the channel_id sent from the backend.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('trading-signals', {
        name: 'Trading Signals',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#1E40AF',
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
      });
    }
  } catch (err) {
    console.warn('[FCM] setupNotifications failed:', err);
  }
}

/**
 * Register for push notifications and send the device token to the backend.
 * No-ops gracefully in Expo Go or on simulators.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (isExpoGo) {
    console.log('[FCM] Skipping push notifications in Expo Go.');
    return null;
  }

  if (!Device.isDevice) {
    console.log('[FCM] Push notifications only work on physical devices.');
    return null;
  }

  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.warn('[FCM] Notification permission not granted.');
      return null;
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
