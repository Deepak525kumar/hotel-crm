import { describe, it, expect } from '@jest/globals';
import { isThemeMode, resolveScheme } from '@/stores/theme-store';

/**
 * Light/dark mode resolution.
 *
 * The apps previously followed the OS scheme with no override, while the web
 * app has always had a theme toggle. `system` stays the default so this changes
 * nobody's appearance until they choose otherwise.
 */
describe('resolveScheme', () => {
  it('follows the OS when set to system', () => {
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', 'light')).toBe('light');
  });

  it('overrides the OS when an explicit mode is chosen', () => {
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
  });

  it('falls back to light when the OS reports no preference', () => {
    // React Native returns null, and on some platforms 'unspecified'. Either
    // would index Colors[scheme] as undefined and crash every themed component.
    expect(resolveScheme('system', null)).toBe('light');
    expect(resolveScheme('system', undefined)).toBe('light');
    expect(resolveScheme('system', 'unspecified')).toBe('light');
  });
});

describe('isThemeMode', () => {
  it('accepts only the three known modes', () => {
    expect(isThemeMode('system')).toBe(true);
    expect(isThemeMode('light')).toBe(true);
    expect(isThemeMode('dark')).toBe(true);
  });

  it('rejects anything else, so a stale stored value cannot render an undefined palette', () => {
    expect(isThemeMode('sepia')).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
  });
});

describe('hydrate', () => {
  it('marks itself hydrated even when storage throws', async () => {
    // The splash screen waits on `hydrated`. If a storage failure left it
    // false, the app would never finish launching — a stuck splash is a far
    // worse outcome than opening in the OS scheme.
    jest.resetModules();
    jest.doMock('@/lib/persistent-storage', () => ({
      getItem: async () => {
        throw new Error('SecureStore unavailable');
      },
      setItem: async () => undefined,
    }));
    const { useThemeStore: store } = require('@/stores/theme-store');

    await store.getState().hydrate();

    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().mode).toBe('system');
  });

  it('falls back to system for an unrecognized stored value', async () => {
    jest.resetModules();
    jest.doMock('@/lib/persistent-storage', () => ({
      getItem: async () => 'sepia',
      setItem: async () => undefined,
    }));
    const { useThemeStore: store } = require('@/stores/theme-store');

    await store.getState().hydrate();

    expect(store.getState().mode).toBe('system');
  });

  it('restores a stored choice', async () => {
    jest.resetModules();
    jest.doMock('@/lib/persistent-storage', () => ({
      getItem: async () => 'dark',
      setItem: async () => undefined,
    }));
    const { useThemeStore: store } = require('@/stores/theme-store');

    await store.getState().hydrate();

    expect(store.getState().mode).toBe('dark');
  });
});
