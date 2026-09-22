import useSWR from 'swr';

import { api } from '@hotel-crm/mobile-shared';

/**
 * Names for ids, fetched once and shared.
 *
 * SEVERAL ENDPOINTS RETURN IDS AND NO NAMES. `CalendarEntryDto` carries
 * `worker_id` and `hotel_id` only, so the rota rendered raw cuids where a
 * person's name belongs — reported by the project owner as "instead of seeing
 * the name for the worker assigned to a shift, I am seeing his ID".
 *
 * The backend fixed the same class of problem for attendance by nesting the
 * names in the DTO, and that is the better fix. Until the calendar DTO does
 * the same, the client resolves them: one `/users` call and one `/crm/hotels`
 * call, both already scoped server-side, both cached by SWR under a stable
 * key so every screen shares one copy rather than refetching.
 *
 * Falls back to the id rather than to an empty string. An id is ugly but it
 * identifies the row; a blank space identifies nothing and looks like a
 * rendering bug.
 */
export function useDirectory() {
  const users = useSWR('directory/users', () => api.users.list({ limit: 200 }), {
    // Names change rarely and this is on every calendar render. Every round
    // trip here is on a hotel's mobile data.
    revalidateOnFocus: false,
    dedupingInterval: 5 * 60_000,
  });
  const hotels = useSWR('directory/hotels', () => api.crm.hotels(), {
    revalidateOnFocus: false,
    dedupingInterval: 5 * 60_000,
  });

  const workerName = (workerId: string): string => {
    const person = users.data?.find((u) => u.id === workerId);
    if (!person) return workerId;
    return `${person.first_name} ${person.last_name}`.trim() || person.email;
  };

  const hotelName = (hotelId: string): string =>
    hotels.data?.find((h) => h.id === hotelId)?.name ?? hotelId;

  return { workerName, hotelName, ready: !!users.data && !!hotels.data };
}
