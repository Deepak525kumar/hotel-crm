import { useEffect } from 'react';
import { useRouter } from 'expo-router';

import {
  registerForPushNotificationsAsync,
  subscribeToPushNotifications,
} from '@/lib/push-notifications';

/**
 * Push registration + the foreground listener, as a component so they run
 * ONLY once ConsentGate has let the app through.
 *
 * Why this is not just a useEffect in the (app) layout, where it used to
 * live: React runs effects on mount regardless of what a component renders.
 * With the daily consent gate live (RULE-CONSENT-01), the layout mounts, the
 * effect fires immediately, and POST /notifications/push-tokens is refused
 * with 403 CONSENT_REQUIRED -- /notifications is gated. The failure is caught
 * and swallowed by design, so nothing crashes and nothing is logged to the
 * user, but registration is documented as running "once per app launch" and
 * does not retry. The device would then receive no push for the rest of that
 * session, even after the worker accepts the notice moments later.
 *
 * Rendering it as a child of ConsentGate makes the ordering structural: the
 * gate renders children only when today's consent is granted, so mount
 * implies consent and the request cannot be refused for that reason.
 *
 * Lifecycle is otherwise unchanged -- ConsentGate keeps its children mounted
 * once granted, so this still runs once per (app)-group entry, not per tab
 * navigation.
 */
export function PushRegistration() {
  const router = useRouter();

  useEffect(() => {
    void registerForPushNotificationsAsync();
  }, []);

  useEffect(() => {
    return subscribeToPushNotifications(router);
  }, [router]);

  return null;
}
