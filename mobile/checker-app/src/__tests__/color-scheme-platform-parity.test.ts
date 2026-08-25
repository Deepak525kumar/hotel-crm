import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';

/**
 * The native and web builds of use-color-scheme must both honour the user's
 * theme setting.
 *
 * `use-color-scheme.web.ts` is a platform override: Expo resolves it instead of
 * `use-color-scheme.ts` on web, and it is loaded by no test — the component
 * project runs under `jest-expo/ios`, so the native file is the one that gets
 * rendered. That is exactly how it drifted: the native hook was moved onto the
 * theme store while the web file kept reading the OS scheme, so the settings
 * screen offered a Light/Dark choice that silently did nothing in a browser.
 *
 * A source assertion rather than a render, matching push-consent-order.test.ts:
 * the failure mode is "this file forgot to consult the store at all", which is
 * visible in the source and cannot be reached by an ios-preset renderer.
 */
describe('use-color-scheme, native and web', () => {
  const native = readFileSync('src/hooks/use-color-scheme.ts', 'utf8');
  const web = readFileSync('src/hooks/use-color-scheme.web.ts', 'utf8');

  it('both read the stored theme mode', () => {
    expect(native).toContain('useThemeStore');
    expect(web).toContain('useThemeStore');
  });

  it('both resolve through the shared helper rather than reimplementing it', () => {
    // resolveScheme owns the "system means follow the OS, and null means light"
    // rule. Two copies of that rule is how the platforms diverge.
    expect(native).toContain('resolveScheme');
    expect(web).toContain('resolveScheme');
  });

  it('neither returns React Native\'s scheme directly', () => {
    // The regression shape: `return colorScheme` straight from useRNColorScheme,
    // which ignores the user's choice entirely.
    expect(web).not.toMatch(/return\s+colorScheme\s*;/);
    expect(native).not.toMatch(/return\s+useSystemColorScheme\(\)\s*;/);
  });
});
