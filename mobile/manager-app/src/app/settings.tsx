import { Redirect } from 'expo-router';

/**
 * Settings moved onto the Profile tab (2026-09-23).
 *
 * Kept as a redirect rather than deleted: `more-menu.ts` no longer links here,
 * but a route that simply vanishes is how this app has shipped dead links
 * three times, and anything still holding the path — a deep link, a saved
 * screenshot, a future push payload — would land on nothing.
 */
export default function Settings() {
  return <Redirect href="/(app)/profile" />;
}
