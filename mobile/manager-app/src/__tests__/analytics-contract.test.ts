import type {
  AnalyticsLeaderboardEntry as MobileLeaderboardRow,
  DashboardStats as MobileDashboardStats,
  HotelSummary as MobileHotelSummary,
} from '@hotel-crm/mobile-shared';
// The backend's OWN declarations, imported rather than restated.
import type {
  DashboardStats as BackendDashboardStats,
  HotelSummary as BackendHotelSummary,
  LeaderboardEntry as BackendLeaderboardRow,
} from '../../../../backend/src/modules/analytics/types';

/**
 * Pins the analytics response types against the backend's own declarations.
 *
 * WHY THIS FILE EXISTS
 *
 * `DashboardStats` in the mobile client used to declare
 * `{ total_shifts, completed_shifts, upcoming_shifts, average_rating }`.
 * The endpoint has never returned any of those four fields. It returns a
 * nested shape of work_requests / assignments / attendance / quality /
 * ratings / rooms_completed, and it always has.
 *
 * Nothing caught it, and nothing could have: the interface was written by
 * hand to describe a response nobody had read back, so `tsc` checked the app
 * against a fiction and passed. Every stat card rendered `undefined`. This is
 * the same defect class as a test that fabricates a permission token -- the
 * code agrees with itself, and with nothing else. This repository has been
 * bitten by both.
 *
 * HOW IT WORKS
 *
 * These are compile-time assignments, so `tsc` is the assertion; the runtime
 * body only exists because jest needs something to run. Assigned in BOTH
 * directions on purpose: `mobile -> backend` alone would accept a mobile type
 * that omits fields, and `backend -> mobile` alone would accept one that
 * invents them. Together they force structural identity, which is the only
 * thing worth pinning -- a client type that is merely "compatible" with the
 * response is how the original bug looked too.
 *
 * If this file stops compiling, the response shape changed. Read the backend
 * type and update the mobile one; do not widen the assertion to make it pass.
 */
describe('analytics response contract', () => {
  it('DashboardStats matches the backend declaration exactly', () => {
    const fromBackend = (value: BackendDashboardStats): MobileDashboardStats => value;
    const fromMobile = (value: MobileDashboardStats): BackendDashboardStats => value;
    expect(typeof fromBackend).toBe('function');
    expect(typeof fromMobile).toBe('function');
  });

  it('HotelSummary matches the backend declaration exactly', () => {
    const fromBackend = (value: BackendHotelSummary): MobileHotelSummary => value;
    const fromMobile = (value: MobileHotelSummary): BackendHotelSummary => value;
    expect(typeof fromBackend).toBe('function');
    expect(typeof fromMobile).toBe('function');
  });

  // The analytics leaderboard row, NOT quality's. Two different endpoints
  // behind two different permission tokens return two different shapes that
  // share only worker_id and rating_tier; managers hold analytics:read and
  // never quality:write, so reading one with the other's type yields
  // undefined in every column that matters.
  it('the analytics leaderboard row matches the backend declaration exactly', () => {
    const fromBackend = (value: BackendLeaderboardRow): MobileLeaderboardRow => value;
    const fromMobile = (value: MobileLeaderboardRow): BackendLeaderboardRow => value;
    expect(typeof fromBackend).toBe('function');
    expect(typeof fromMobile).toBe('function');
  });
});
