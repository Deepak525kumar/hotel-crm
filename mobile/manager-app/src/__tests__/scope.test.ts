// The module directly, not the package barrel: the barrel re-exports the UI
// components, which drags the whole React Native component tree into a
// node-environment unit test that has no business rendering anything. Same
// reason locales.test.ts imports its module directly.
import { scopeOf } from '@hotel-crm/mobile-shared/src/lib/scope';
import { percent, score } from '@/lib/format-metrics';
import { ALL_HOTELS, canChooseHotel, hotelFilterFor } from '@/lib/hotel-filter';

/**
 * Scope derivation, and the reason it is a function rather than an inline
 * ternary in each screen.
 *
 * An admin and a regional manager BOTH have `scope_hotel_id === null`. Every
 * screen that branches on `role === 'admin'` therefore shows a regional
 * manager the entire platform, and nothing errors -- the request succeeds,
 * the numbers are simply someone else's. frontend/CLAUDE.md records the same
 * rule for the web app; this is its executable form.
 */
describe('scopeOf', () => {
  it('a hotel manager is scoped to exactly their hotel', () => {
    expect(scopeOf({ role: 'manager', scope_hotel_id: 'h1', scope_hotel_group_id: null })).toEqual({
      kind: 'hotel',
      hotelId: 'h1',
    });
  });

  it('a regional manager is scoped to their group, not the platform', () => {
    expect(
      scopeOf({ role: 'regional_manager', scope_hotel_id: null, scope_hotel_group_id: 'g1' })
    ).toEqual({ kind: 'group', hotelGroupId: 'g1' });
  });

  it('an admin is global', () => {
    expect(scopeOf({ role: 'admin', scope_hotel_id: null, scope_hotel_group_id: null })).toEqual({
      kind: 'global',
    });
  });

  // The case that makes the null check worth writing down: same null
  // scope_hotel_id as an admin, completely different answer.
  it('an RM and an admin both have a null hotel id and do NOT resolve alike', () => {
    const admin = scopeOf({ role: 'admin', scope_hotel_id: null, scope_hotel_group_id: null });
    const rm = scopeOf({
      role: 'regional_manager',
      scope_hotel_id: null,
      scope_hotel_group_id: 'g1',
    });
    expect(admin.kind).toBe('global');
    expect(rm.kind).not.toBe('global');
  });

  it('a scoped role with no claim at all is denied, never treated as global', () => {
    // ADR-030 D-7: a null scope denies every scoped capability server-side.
    // Rendering it as "everything" would promise data every request refuses.
    expect(
      scopeOf({ role: 'manager', scope_hotel_id: null, scope_hotel_group_id: null }).kind
    ).toBe('none');
  });

  it('the broader claim wins when both are somehow present', () => {
    // Matches the backend's own precedence in resolveScope().
    expect(
      scopeOf({ role: 'regional_manager', scope_hotel_id: 'h1', scope_hotel_group_id: 'g1' }).kind
    ).toBe('group');
  });

  it('a signed-out user has no scope', () => {
    expect(scopeOf(null).kind).toBe('none');
  });
});

describe('metric formatting', () => {
  // The distinction this exists for: a hotel with no inspections has not
  // scored zero. Rendering null as 0% reads as a crisis; an em dash reads as
  // a quiet week, which is what it is.
  it('renders a null rate as an em dash, never 0%', () => {
    expect(percent(null)).toBe('—');
    expect(percent(undefined)).toBe('—');
    expect(score(null)).toBe('—');
  });

  it('renders a real zero as 0%, which is not the same thing', () => {
    expect(percent(0)).toBe('0%');
  });

  it('accepts the 0-100 convention the API actually uses', () => {
    expect(percent(87)).toBe('87%');
    expect(percent(100)).toBe('100%');
  });

  it('scales a 0-1 fraction, since the API mixes both conventions', () => {
    expect(percent(0.5)).toBe('50%');
  });
});

describe('hotel filtering', () => {
  // A picker offering one option is a control that cannot change anything --
  // worse than no picker, because it implies a choice exists.
  it('offers no choice to a hotel manager, whose scope is already one hotel', () => {
    expect(canChooseHotel({ kind: 'hotel', hotelId: 'h1' })).toBe(false);
  });

  it('offers a choice to a regional manager and to an admin', () => {
    expect(canChooseHotel({ kind: 'group', hotelGroupId: 'g1' })).toBe(true);
    expect(canChooseHotel({ kind: 'global' })).toBe(true);
  });

  it('offers no choice on a null scope, which the server denies outright', () => {
    expect(canChooseHotel({ kind: 'none' })).toBe(false);
  });

  // The sentinel must never reach a URL: '/analytics/stats?hotel_id=__all__'
  // is a 403 for a scoped caller and a 404-shaped nothing for an admin.
  it('maps the all-hotels sentinel back to no filter, never to an id', () => {
    expect(hotelFilterFor(ALL_HOTELS)).toBeUndefined();
    expect(hotelFilterFor(null)).toBeUndefined();
    expect(hotelFilterFor('h1')).toBe('h1');
  });
});
