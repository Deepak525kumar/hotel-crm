"use client";

import useSWR from "swr";
import { roomsApi } from "@/lib/api";

/**
 * Room-log reads (owner decision, 2026-09-01).
 *
 * None of these hooks takes a `day`: "today" is resolved server-side in the
 * platform calendar timezone (Europe/Berlin), so passing a browser-computed
 * date would make the web disagree with the server — and with mobile — for the
 * first two hours of every day. Callers that genuinely need another day should
 * call `roomsApi` directly with an explicit, user-chosen date.
 */

/** The signed-in worker's own rooms. Self-scoped server-side; no id is sent. */
export function useMyRooms() {
  return useSWR(["rooms-mine"], () => roomsApi.mine(), { refreshInterval: process.env.NODE_ENV === 'test' ? 0 : 5000 });
}

/**
 * Room numbers already used at a hotel, for the log input's typeahead.
 *
 * Keyed on the hotel so switching shifts refetches. The endpoint 403s for a
 * hotel the caller has never worked at, which SWR surfaces as an error the
 * input treats as "no suggestions" rather than a failure — the typeahead is an
 * aid, and losing it must never block logging a room.
 */
export function useRoomSuggestions(hotelId: string | null | undefined) {
  return useSWR(
    hotelId ? ["room-suggestions", hotelId] : null,
    ([, id]) => roomsApi.suggestions(id),
    // A hotel's room numbering barely changes within a shift, and this is
    // re-read on every keystroke's render; refetching on focus would be a
    // request per window switch for data that is effectively static.
    { revalidateOnFocus: false },
  );
}

/**
 * The checker's room picker for one hotel.
 *
 * `hotelId` NARROWS an already-server-scoped list; it cannot widen it. An
 * out-of-scope hotel returns 403 rather than an empty list, which is why the
 * consumer must offer its manual-room fallback on error as well as on empty.
 */
export function useRoomsForCheck(hotelId: string | null | undefined) {
  return useSWR(
    hotelId ? ["rooms-for-check", hotelId] : null,
    ([, id]) => roomsApi.forCheck({ hotel_id: id }),
    { refreshInterval: process.env.NODE_ENV === 'test' ? 0 : 5000 }
  );
}

/** Manager/RM/admin live view of one hotel's rooms logged today. */
export function useRoomsForHotel(hotelId: string | null | undefined) {
  return useSWR(
    hotelId ? ["rooms-for-hotels", hotelId] : null,
    ([, id]) => roomsApi.forHotels({ hotel_id: id }),
  );
}
