import { useEffect, useRef } from 'react';
import { AppState, Alert, Platform, Linking } from 'react-native';
import Constants from 'expo-constants';
import { PUSH_APP } from '@/constants/app-config';
import { isVersionGreater } from '@/lib/compare-versions';

// Daiwi Version Control Service URL
const DAIWI_URL = process.env.EXPO_PUBLIC_DAIWI_URL ?? 'https://api.hotelcrm.app';

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
        const res = await fetch(`${baseUrl}/install/api/latest?app=${PUSH_APP}&platform=${platform}`);
        if (!res.ok) return;
        
        const data = await res.json();
        if (!data.available) return;

        const currentBuildStr = Constants.nativeBuildVersion;
        if (!currentBuildStr) return;
        
        // If Daiwi's build number is strictly greater semantically, enforce an update
        if (data.buildNumber && isVersionGreater(String(data.buildNumber), String(currentBuildStr))) {
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
