/**
 * Reads the device's coordinates, tolerating expo-location being absent.
 *
 * `import * as Location from 'expo-location'` is a TOP-LEVEL import, and when
 * the native module is not in the running binary it throws
 * `Cannot find native module 'ExpoLocation'` at module evaluation time. That
 * takes the whole importing module down with it -- and because the module then
 * never finishes evaluating, expo-router reports the far more confusing
 *
 *     Route "./shift/[id].tsx" is missing the required default export.
 *
 * even though the default export is right there. Both messages have one cause.
 * A dev build made before expo-location was added to package.json will not
 * contain the native module until it is rebuilt, so this is easy to hit.
 *
 * Losing GPS must not cost a worker the ability to start their shift. The
 * check-in path already treated coordinates as best-effort -- its runtime
 * try/catch says "backend decides whether this hotel requires it" -- but the
 * import crashed before any of that could run. Requiring lazily, inside a
 * try/catch, makes the degradation match the intent that was already there.
 */
export type Coordinates = { latitude: number; longitude: number };

/** Shape of the slice of expo-location this module uses. */
type LocationModule = {
  requestForegroundPermissionsAsync: () => Promise<{ status: string }>;
  getCurrentPositionAsync: (options: Record<string, unknown>) => Promise<{
    coords: { latitude: number; longitude: number };
  }>;
};

let cached: LocationModule | null | undefined;

/**
 * `require` rather than a static import, deliberately: a static import is
 * hoisted and evaluated when this module loads, which is the exact failure
 * being defended against. Resolved once and memoised, including the failure,
 * so a build without the native module does not retry on every check-in.
 */
function loadLocationModule(): LocationModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-location') as LocationModule;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Current coordinates, or undefined when unavailable for ANY reason --
 * module missing, permission denied, or the fix itself failing. Callers treat
 * all three identically: send the check-in without coordinates and let the
 * backend apply whatever this hotel's policy is.
 */
export async function getCoordinatesIfAvailable(): Promise<Coordinates | undefined> {
  const Location = loadLocationModule();
  if (!Location) return undefined;

  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return undefined;
    const position = await Location.getCurrentPositionAsync({});
    return { latitude: position.coords.latitude, longitude: position.coords.longitude };
  } catch {
    return undefined;
  }
}

/** Test seam: resets the memoised module between cases. */
export function __resetLocationModuleCache(): void {
  cached = undefined;
}
