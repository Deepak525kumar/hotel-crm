import type { ScopeShape } from '@hotel-crm/mobile-shared';

/** The sentinel the picker uses for "no hotel filter". Never a hotel id. */
export const ALL_HOTELS = '__all__';

/**
 * Whether this actor has a hotel choice to make at all.
 *
 * A hotel manager does not: their scope IS one hotel, so a picker would offer
 * a single option and change nothing. An admin and a regional manager both
 * do, and both have a null `scope_hotel_id` -- which is exactly why this asks
 * the scope rather than the role.
 *
 * A null scope (`none`) gets no picker either: the server denies every scoped
 * capability on it (ADR-030 D-7), so there is nothing to narrow.
 */
export function canChooseHotel(scope: ScopeShape): boolean {
  return scope.kind === 'group' || scope.kind === 'global';
}

/** Maps the picker's sentinel back to "no filter" before it reaches a URL. */
export function hotelFilterFor(selected: string | null): string | undefined {
  if (selected === null || selected === ALL_HOTELS) return undefined;
  return selected;
}
