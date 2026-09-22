import { Platform } from 'react-native';
import Constants from 'expo-constants';
import type { useRouter } from 'expo-router';
import { api , useNotificationStore } from '@hotel-crm/mobile-shared';
import { PUSH_APP } from '@/constants/app-config';

/**
 * Resolves the in-app route a tapped push notification should open, from
 * its `data` payload — `type` is always present (composed by
 * PushTransportHandler.deliver() in
 * backend/src/modules/notifications/outbox-transport.ts, alongside
 * whatever Notification.data itself carries, e.g. work_request_id for a
 * JOB_REQUEST_BROADCAST). Extracted as a pure function so the routing
 * decision is independently testable without mocking expo-notifications'
 * listener plumbing.
 *
 * Falls back to the Alerts tab for any notification type this function
 * doesn't recognize (including a payload with no `type` at all, or a
 * `type` this app version predates) — the safe default this app already
 * had for every notification before per-type routing existed.
 */
// Re-exported so every existing caller and the public surface are unchanged;
// the implementation moved to keep it testable (see push-routes.ts). Imported
// as well, because this module calls it itself when a notification is tapped.
import { resolvePushTapRoute } from './push-routes';

type Router = ReturnType<typeof useRouter>;

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

  // Expo Go on Android no longer supports remote push notifications
  if (Platform.OS === 'android' && Constants.appOwnership === 'expo') {
    console.warn('Push token registration skipped: not supported in Expo Go on Android.');
    return 'unsupported-platform';
  }

  try {
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
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

export { resolvePushTapRoute };

/**
 * Foreground display + tap-through routing for incoming push notifications.
 *
 * Backend delivery (Platform Worker -> APNs/FCM, PR 7.5) was already real
 * before this: without this wiring, a push arriving while the app is open
 * produced no in-app banner (the OS suppresses a system notification for the
 * foreground app by default), and tapping a delivered notification did
 * nothing beyond returning to whatever screen was already open. Both gaps
 * are closed here using only already-registered `expo-notifications`
 * listeners -- no new channel, no new backend call, no websocket.
 *
 * Returns an unsubscribe function; call once from the signed-in app's root
 * layout (mirrors registerForPushNotificationsAsync's placement) and clean
 * up on unmount.
 *
 * Duplicated verbatim in mobile/checker-app/src/lib/push-notifications.ts
 * (two independent Expo apps, no shared package between them today). Not
 * worth extracting yet for one call site each. If a future change adds
 * more per-type deep links, notification categories, or other behavior
 * beyond this, consider extracting a shared mobile package at that point
 * rather than editing both copies again — the checker app has no
 * broadcast/offer concept and is deliberately NOT updated by this change.
 */
export function subscribeToPushNotifications(router: Router): () => void {
  // Web does not support foreground push handlers in the same way, and calling
  // setNotificationHandler on web can throw or cause issues.
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return () => {};
  }

  // Expo Go on Android no longer supports remote push notifications
  if (Platform.OS === 'android' && Constants.appOwnership === 'expo') {
    return () => {};
  }

  const Notifications = require('expo-notifications') as typeof import('expo-notifications');

  // Foreground behavior: show the OS banner/sound/badge even while the app
  // is open, rather than the SDK default of suppressing it. `notifications`
  // is the app's only channel (Alerts tab lists the same rows), so there is
  // no per-type filtering to do here.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  // Tapping a delivered notification (from the tray, or the in-app banner
  // above) routes per resolvePushTapRoute() -- a recognized
  // JOB_REQUEST_BROADCAST payload opens that offer directly; anything else
  // falls back to the Alerts tab, same as before per-type routing existed.
  const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
    const route = resolvePushTapRoute(response.notification.request.content.data);
    router.push(route as Parameters<Router['push']>[0]);
  });

  // A delivered push means the server created a notification, so the bell's
  // unread count is now stale. Polling alone would leave it wrong for up to a
  // minute while the banner is on screen saying otherwise.
  const receivedSub = Notifications.addNotificationReceivedListener(() => {
    void useNotificationStore.getState().refresh();
  });

  return () => {
    responseSub.remove();
    receivedSub.remove();
  };
}
