import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '@/lib/api';
import { PUSH_APP } from '@/constants/app-config';

/**
 * Device push-token registration (Epic 7 PR 7.7, ADR-029 §4).
 *
 * Requests the OS notification permission, reads the raw device push token,
 * and registers it against the backend's `POST /notifications/push-tokens`.
 *
 * Deliberately uses `getDevicePushTokenAsync()` (the raw APNs/FCM token), not
 * `getExpoPushTokenAsync()`: the Platform Worker talks to APNs and FCM
 * directly (PR 7.5) rather than relaying through Expo's push service, so an
 * Expo token would be undeliverable.
 *
 * Never throws. Push is an enhancement, not a precondition for using the app —
 * a denied permission, a simulator with no push capability, or a backend
 * hiccup must not break login or block the UI. The outcome is returned so
 * callers (and tests) can distinguish the cases instead of guessing.
 */
export type PushRegistrationOutcome =
  | 'registered'
  | 'permission-denied'
  | 'unsupported-platform'
  | 'failed';

export async function registerForPushNotificationsAsync(): Promise<PushRegistrationOutcome> {
  // Web has no device push token; `getDevicePushTokenAsync()` would reject.
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return 'unsupported-platform';
  }

  try {
    // Ask only when not already granted: on iOS the OS prompt is one-shot, and
    // re-requesting an already-granted permission is a needless round-trip.
    const existing = await Notifications.getPermissionsAsync();
    const status =
      existing.status === 'granted'
        ? existing.status
        : (await Notifications.requestPermissionsAsync()).status;

    if (status !== 'granted') {
      return 'permission-denied';
    }

    const devicePushToken = await Notifications.getDevicePushTokenAsync();

    await api.notifications.registerPushToken({
      token: devicePushToken.data,
      platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
      app: PUSH_APP,
    });

    return 'registered';
  } catch (error) {
    // Swallowed by design (see the doc comment). Logged rather than silent so
    // a registration failure is still diagnosable from device logs.
    console.warn('Push token registration failed', error);
    return 'failed';
  }
}
