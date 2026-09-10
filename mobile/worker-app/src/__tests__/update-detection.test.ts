import { isVersionGreater } from '@/lib/compare-versions';

/**
 * WHY UPDATE DETECTION NEVER FIRED, reported 2026-09-10: a new version was
 * published and no installed app noticed.
 *
 * Four independent faults, each on its own enough to break it:
 *
 *   1. `EXPO_PUBLIC_DAIWI_URL` was referenced in `UpdateChecker.tsx` and set
 *      NOWHERE -- not eas.json, not app.json, not any .env. Every build used
 *      the hard-coded fallback `https://api.hotelcrm.app`, which is NXDOMAIN
 *      (the live stack is deepcleaninghub.de). The fetch threw instantly and
 *      was swallowed by a bare catch.
 *   2. Daiwi's DEPLOYED build predated the `/install/api/latest` route --
 *      `dist/` was built 2026-08-31, the source adding the endpoint landed
 *      2026-09-01. The path 404'd even from localhost.
 *   3. Daiwi listens on 127.0.0.1:3002 and nginx had no route to it, so no
 *      phone could reach it whatever URL it used.
 *   4. THE ONE THESE TESTS COVER: every build ever published carries
 *      buildNumber 1, and the check compared build numbers only. `1 > 1` is
 *      false, so even with the first three fixed nothing would ever prompt.
 *
 * The comparison is the half that lives in the app, so it is the half pinned
 * here. Faults 1-3 are configuration and deployment, recorded above so the
 * next person reading this file knows the test suite is not the whole story.
 */
describe('isVersionGreater — the comparison update detection rests on', () => {
  it('does not fire when the published build equals the installed one', () => {
    // The exact production state: every build is "1".
    expect(isVersionGreater('1', '1')).toBe(false);
  });

  it('fires on a newer build number', () => {
    expect(isVersionGreater('2', '1')).toBe(true);
    expect(isVersionGreater('11', '9')).toBe(true);
  });

  /**
   * The case the app now also checks. Publishing 1.1.0 while the build number
   * stays at 1 is the ordinary way to ship, and comparing build numbers alone
   * ignored it completely.
   */
  it('fires on a newer version even when the build number has not moved', () => {
    expect(isVersionGreater('1.1.0', '1.0.0')).toBe(true);
    expect(isVersionGreater('2.0.0', '1.9.9')).toBe(true);
  });

  it('compares segments numerically, not as text', () => {
    // "1.10.0" < "1.9.0" under string comparison, and this is the bug that
    // makes naive version checks fail on the tenth release rather than the
    // first, when nobody is looking any more.
    expect(isVersionGreater('1.10.0', '1.9.0')).toBe(true);
    expect(isVersionGreater('1.9.0', '1.10.0')).toBe(false);
  });

  it('treats a missing trailing segment as zero', () => {
    expect(isVersionGreater('1.2', '1.2.0')).toBe(false);
    expect(isVersionGreater('1.2.1', '1.2')).toBe(true);
  });

  it('never fires downgrade or on absent values', () => {
    expect(isVersionGreater('1.0.0', '1.1.0')).toBe(false);
    expect(isVersionGreater('', '1.0.0')).toBe(false);
    expect(isVersionGreater('1.0.0', '')).toBe(false);
  });

  /**
   * A forced-update alert that cannot be dismissed is shown on the strength
   * of this function. Garbage must not read as "newer" and lock a worker out
   * of the app mid-shift.
   */
  it('does not fire on unparseable input', () => {
    expect(isVersionGreater('abc', '1.0.0')).toBe(false);
    expect(isVersionGreater('v2', '1')).toBe(false);
  });
});
