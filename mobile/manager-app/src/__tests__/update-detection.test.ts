import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isVersionGreater } from '@/lib/compare-versions';

/**
 * Update detection for the manager app — the same mechanism worker and
 * checker carry, pinned the same way plus the configuration that broke it.
 *
 * WHY IT NEVER FIRED (reported 2026-09-10, four independent faults):
 *
 *   1. `EXPO_PUBLIC_DAIWI_URL` was referenced and set NOWHERE, so every build
 *      used the hard-coded fallback `https://api.hotelcrm.app` — NXDOMAIN,
 *      from a deployment that never happened. The fetch threw and a bare
 *      catch swallowed it.
 *   2. Daiwi's deployed bundle predated the `/install/api/latest` route, so
 *      the path 404'd even from localhost.
 *   3. Daiwi listens on 127.0.0.1:3002 and nginx had no route to it.
 *   4. Every published build carried buildNumber 1 and the check compared
 *      build numbers only: `1 > 1` is false, so nothing could ever prompt.
 *
 * All four are fixed. Faults 1 and 4 live in this app and are asserted below;
 * 2 and 3 are deployment and are recorded so nobody reads a green suite as
 * proof the whole path works.
 *
 * ONE THING NO TEST HERE CAN PROVE. An installed app checks for updates using
 * the code it already contains. A handset running a build cut before these
 * fixes will never prompt, however many versions are published — the only way
 * out is to distribute one fixed build by hand. Verified 2026-09-23: the
 * endpoint answers correctly in production, and worker/checker do not prompt
 * because the published build IS the installed build (1.0.0 / 2), which is
 * the correct outcome, not a fault.
 */
describe('update detection (manager-app)', () => {
  describe('isVersionGreater — the comparison the prompt rests on', () => {
    it('does not fire when the published build equals the installed one', () => {
      expect(isVersionGreater('1', '1')).toBe(false);
      expect(isVersionGreater('1.0.0', '1.0.0')).toBe(false);
    });

    it('fires on a newer build number', () => {
      expect(isVersionGreater('2', '1')).toBe(true);
    });

    it('fires on a newer version even when the build number has not moved', () => {
      // The case that was silently ignored: shipping 1.1.0 over 1.0.0 with an
      // unchanged build number is the normal thing to do.
      expect(isVersionGreater('1.1.0', '1.0.0')).toBe(true);
    });

    it('compares segments numerically, not as text', () => {
      // '10' < '9' as strings, which would skip every tenth release.
      expect(isVersionGreater('1.10.0', '1.9.0')).toBe(true);
    });

    it('never fires on a downgrade or on absent values', () => {
      expect(isVersionGreater('1.0.0', '1.1.0')).toBe(false);
      expect(isVersionGreater('', '1.0.0')).toBe(false);
      expect(isVersionGreater('1.0.0', '')).toBe(false);
    });
  });

  describe('the configuration that made the check unreachable', () => {
    const appDir = join(__dirname, '..', '..');
    const checker = readFileSync(
      join(appDir, 'src', 'components', 'UpdateChecker.tsx'),
      'utf8'
    );

    it('does not fall back to the host that does not resolve', () => {
      // `api.hotelcrm.app` is NXDOMAIN. It was the fallback in every shipped
      // build, and the only symptom was a swallowed warn.
      //
      // Asserted against the DECLARATION, not the file: the block comment
      // above it names the dead host while explaining the history, so a bare
      // `not.toContain('hotelcrm.app')` fails on the explanation rather than
      // on the code. Matching a comment instead of a code shape is its own
      // recurring mistake in this repository.
      const declaration = checker.match(/^const DAIWI_URL =.*$/m)?.[0] ?? '';
      expect(declaration).toContain('api.deepcleaninghub.de');
      expect(declaration).not.toContain('hotelcrm.app');
    });

    it('is given the URL by both EAS build profiles', () => {
      // A fallback that works is not a substitute for the variable being set:
      // the fallback is the thing that hid the fault for three weeks.
      const eas = readFileSync(join(appDir, 'eas.json'), 'utf8');
      expect(eas.match(/EXPO_PUBLIC_DAIWI_URL/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
      expect(eas).toContain('https://api.deepcleaninghub.de');
    });

    it('asks about THIS app, not another one', () => {
      // `appForBundleId()` in daiwi refuses rather than guesses, so asking
      // under the wrong key returns another app's build — and the prompt
      // would send a manager to install the worker app.
      expect(checker).toContain('app=${PUSH_APP}');
      const config = readFileSync(join(appDir, 'src', 'constants', 'app-config.ts'), 'utf8');
      expect(config).toContain("PUSH_APP: PushApp = 'MANAGER'");
    });

    it('compares the version as well as the build number', () => {
      // Fault 4. Both must be consulted, or a version-only release is
      // invisible to every installed app.
      expect(checker).toContain('buildIsNewer');
      expect(checker).toContain('versionIsNewer');
      expect(checker).toMatch(/buildIsNewer \|\| versionIsNewer/);
    });
  });
});
