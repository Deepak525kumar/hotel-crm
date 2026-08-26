import { __resetLocationModuleCache, getCoordinatesIfAvailable } from '@/lib/optional-location';

/**
 * Guards the fix for a crash that presented as something else entirely:
 * a missing `ExpoLocation` native module made `shift/[id].tsx` fail to
 * evaluate, and expo-router then reported "missing the required default
 * export" for a file whose default export was plainly there.
 */
describe('getCoordinatesIfAvailable', () => {
  beforeEach(() => {
    __resetLocationModuleCache();
    jest.resetModules();
  });

  it('returns undefined instead of throwing when the native module is absent', () => {
    jest.doMock('expo-location', () => {
      throw new Error("Cannot find native module 'ExpoLocation'");
    });
    const { getCoordinatesIfAvailable: fn, __resetLocationModuleCache: reset } =
      require('@/lib/optional-location');
    reset();
    return expect(fn()).resolves.toBeUndefined();
  });

  it('returns undefined when permission is denied', async () => {
    jest.doMock('expo-location', () => ({
      requestForegroundPermissionsAsync: async () => ({ status: 'denied' }),
      getCurrentPositionAsync: async () => {
        throw new Error('should not be called when permission is denied');
      },
    }));
    const { getCoordinatesIfAvailable: fn, __resetLocationModuleCache: reset } =
      require('@/lib/optional-location');
    reset();
    await expect(fn()).resolves.toBeUndefined();
  });

  it('returns coordinates when permission is granted', async () => {
    jest.doMock('expo-location', () => ({
      requestForegroundPermissionsAsync: async () => ({ status: 'granted' }),
      getCurrentPositionAsync: async () => ({ coords: { latitude: 52.52, longitude: 13.405 } }),
    }));
    const { getCoordinatesIfAvailable: fn, __resetLocationModuleCache: reset } =
      require('@/lib/optional-location');
    reset();
    await expect(fn()).resolves.toEqual({ latitude: 52.52, longitude: 13.405 });
  });

  it('returns undefined when the position fix itself fails', async () => {
    jest.doMock('expo-location', () => ({
      requestForegroundPermissionsAsync: async () => ({ status: 'granted' }),
      getCurrentPositionAsync: async () => {
        throw new Error('location unavailable');
      },
    }));
    const { getCoordinatesIfAvailable: fn, __resetLocationModuleCache: reset } =
      require('@/lib/optional-location');
    reset();
    await expect(fn()).resolves.toBeUndefined();
  });
});

describe('shift detail route', () => {
  it('imports expo-location lazily, not at module scope', () => {
    // The static import is what crashed the route. If it comes back, the
    // screen disappears again with a misleading error, so assert on the source.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'app', 'shift', '[id].tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/^import .*from 'expo-location'/m);
  });
});
