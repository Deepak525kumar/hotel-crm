import { useEffect, useRef } from 'react';
import { AppState, Alert, Platform, Linking } from 'react-native';
import Constants from 'expo-constants';
import { PUSH_APP } from '@/constants/app-config';
import { isVersionGreater } from '@/lib/compare-versions';

/**
 * Daiwi (version control service) base URL.
 *
 * THE FALLBACK USED TO BE `https://api.hotelcrm.app`, WHICH IS NXDOMAIN.
 * `EXPO_PUBLIC_DAIWI_URL` was referenced here and set nowhere -- not in
 * eas.json, not in app.json, not in any .env -- so every build ever shipped
 * used the fallback, resolved nothing, threw, and was swallowed by the catch
 * below. The update check could not have worked in any installed app, which
 * is exactly what was reported: a new version published, and no device
 * noticing.
 *
 * `hotelcrm.app` is the domain from a deployment that never happened; the
 * live stack is deepcleaninghub.de. The env var is now set for both build
 * profiles in eas.json, and the fallback points at the real host so a build
 * that somehow misses the variable still reaches a server that exists.
 */
const DAIWI_URL = process.env.EXPO_PUBLIC_DAIWI_URL ?? 'https://api.deepcleaninghub.de';

export function UpdateChecker({ children }: { children: React.ReactNode }) {
  const isCheckingRef = useRef(false);
  const isAlertVisibleRef = useRef(false);

  useEffect(() => {
    const checkUpdate = async () => {
      // Prevent race conditions: don't check if one is already in flight,
      // or if the mandatory update alert is already on the screen.
      if (isCheckingRef.current || isAlertVisibleRef.current) return;
      isCheckingRef.current = true;

      try {
        const platform = Platform.OS === 'ios' ? 'IOS' : 'ANDROID';
        
        // Fetch the latest production build from Daiwi for this specific app and platform
        const baseUrl = DAIWI_URL.replace(/\/$/, '');
        const url = `${baseUrl}/install/api/latest?app=${PUSH_APP}&platform=${platform}`;
        const res = await fetch(url);
        if (!res.ok) {
          // Named loudly. A 404 here means the endpoint is not deployed and a
          // network error means the host is wrong -- both were true at once,
          // and both were invisible because the only signal was a generic
          // warn in the catch below.
          console.warn(`Update check failed: ${res.status} from ${url}`);
          return;
        }
        
        const data = await res.json();
        if (!data.available) return;

        // BOTH THE VERSION AND THE BUILD NUMBER, not just the build number.
        //
        // This compared `buildNumber` alone. Every build ever published to
        // Daiwi carries buildNumber 1 -- `app.json` pins `versionCode: 1` /
        // `buildNumber: 1`, and whatever produces the artifacts is not
        // applying EAS's remote autoIncrement -- so `1 > 1` was false forever
        // and no device could ever see an update, however many were
        // published.
        //
        // Publishing a build with a new `version` (1.0.0 -> 1.1.0) and an
        // unchanged build number is the normal thing to do and was silently
        // ignored. Either being greater now counts: the build number stays
        // the precise signal when it moves, and the version covers the case
        // where it does not.
        const currentBuildStr = Constants.nativeBuildVersion;
        const currentVersionStr = Constants.expoConfig?.version;

        const buildIsNewer = Boolean(
          data.buildNumber &&
            currentBuildStr &&
            isVersionGreater(String(data.buildNumber), String(currentBuildStr))
        );
        const versionIsNewer = Boolean(
          data.version &&
            currentVersionStr &&
            isVersionGreater(String(data.version), String(currentVersionStr))
        );

        if (buildIsNewer || versionIsNewer) {
          isAlertVisibleRef.current = true;
          Alert.alert(
            'Update Required',
            `A new version (${data.version}) of the app is available. Please update to continue.`,
            [
              {
                text: 'Update Now',
                onPress: () => {
                  isAlertVisibleRef.current = false;
                  if (data.installUrl) {
                    Linking.openURL(data.installUrl);
                  }
                }
              }
            ],
            // Prevent the user from dismissing the alert (forces update)
            { cancelable: false }
          );
        }
      } catch (e) {
        // Silently fail if unable to check version (e.g. offline)
        console.warn('Failed to check for updates:', e);
      } finally {
        isCheckingRef.current = false;
      }
    };

    // 1. Check immediately on app startup
    checkUpdate();

    // 2. Check every time the app comes back to the foreground
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        checkUpdate();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  // Wraps around the app layout
  return <>{children}</>;
}
