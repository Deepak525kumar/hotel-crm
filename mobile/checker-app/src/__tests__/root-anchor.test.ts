import fs from 'fs';
import path from 'path';

/**
 * The app must open on index.tsx, which redirects to (app) when signed in and
 * to login when not.
 *
 * Reported live: the app opened on the Consent screen -- the one under
 * Profile -- whether or not consent had been given. expo-router's
 * getSortedChildren() puts explicitly declared <Stack.Screen> children ahead
 * of the file-system routes, and React Navigation treats a stack's first
 * screen as its initial route when none is named. The root layout declares
 * `consent` first (only to set headerShown), which made it the entry point
 * and meant index.tsx never rendered.
 *
 * A source assertion rather than a render test on purpose: the failure was
 * in how the navigator was CONFIGURED, and it is re-introduced by reordering
 * or adding a <Stack.Screen> -- an edit no render of a single screen would
 * catch.
 */
const layout = fs.readFileSync(
  path.join(__dirname, '..', 'app', '_layout.tsx'),
  'utf8'
);

describe('root layout anchors the app to index', () => {
  it('declares an initial route rather than depending on Stack.Screen order', () => {
    expect(layout).toMatch(/export const unstable_settings\s*=/);
  });

  it("names `index` as that route, under both this version's key and the older one", () => {
    const settings = layout.slice(layout.indexOf('export const unstable_settings'));
    expect(settings).toMatch(/anchor:\s*'index'/);
    expect(settings).toMatch(/initialRouteName:\s*'index'/);
  });

  // The specific regression: `consent` is still declared (it needs its
  // options) but must no longer be what the app opens on.
  it('still declares the consent screen, which is why the anchor is needed', () => {
    expect(layout).toMatch(/Stack\.Screen\s+name="consent"/);
  });
});
