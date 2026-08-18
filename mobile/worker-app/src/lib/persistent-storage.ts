import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Persistent key/value storage, per platform.
 *
 * expo-secure-store has NO web implementation -- its web build is literally
 * `export default {}`, so `setItemAsync` is undefined there and throws. That
 * made browser login fail outright: the API returned 200, the store threw
 * while persisting, and the login screen reported a generic "Login failed".
 *
 * On iOS/Android this stays exactly as it was: the platform keychain /
 * EncryptedSharedPreferences, via SecureStore.
 *
 * On web it falls back to localStorage, which is a DELIBERATE and weaker
 * trade-off, made because browser login is a supported target (owner
 * decision, 2026-08-18):
 *
 *  - localStorage is readable by any script running on the origin, so a
 *    successful XSS can exfiltrate the tokens. The phone keychain is not
 *    exposed that way.
 *  - The Next.js web app at deepcleaninghub.de deliberately does NOT do this
 *    -- it uses httpOnly cookies the page's own JavaScript cannot read. That
 *    remains the stronger pattern, and is the thing to move this to if the
 *    Expo web build ever becomes a primary surface rather than a convenience.
 *
 * Access tokens are short-lived (15m) which limits, but does not remove, the
 * exposure -- the refresh token stored alongside them is long-lived.
 *
 * Web writes are wrapped: Safari private mode and storage-partitioned
 * contexts throw on setItem rather than silently no-op, and a storage failure
 * must not take down a session whose tokens are already in memory.
 */

const isWeb = Platform.OS === 'web';

function webStore(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // access itself can throw in a partitioned context
  }
}

export async function getItem(key: string): Promise<string | null> {
  if (!isWeb) return SecureStore.getItemAsync(key);
  try {
    return webStore()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  if (!isWeb) {
    await SecureStore.setItemAsync(key, value);
    return;
  }
  try {
    webStore()?.setItem(key, value);
  } catch {
    // Non-fatal by design: the caller already holds the value in memory and
    // the session continues. Mirrors the existing "storage write failed;
    // session continues" posture in lib/api.ts's refresh path.
  }
}

export async function deleteItem(key: string): Promise<void> {
  if (!isWeb) {
    await SecureStore.deleteItemAsync(key);
    return;
  }
  try {
    webStore()?.removeItem(key);
  } catch {
    // Same reasoning as setToken. A failed clear must never block logout.
  }
}
