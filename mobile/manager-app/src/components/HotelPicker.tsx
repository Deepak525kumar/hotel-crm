import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { SelectSheet, api, type ScopeShape } from '@hotel-crm/mobile-shared';

import { ALL_HOTELS, canChooseHotel } from '@/lib/hotel-filter';

/**
 * Narrows a scoped screen to one hotel.
 *
 * Renders NOTHING for a hotel manager. Their scope is exactly one hotel, so a
 * picker with a single option is a control that cannot change anything --
 * worse than absent, because it implies a choice exists. `frontend/CLAUDE.md`
 * records the same rule for the web: `scope_hotel_id` is set only for a hotel
 * manager, and admin and regional manager both have it null and must pick.
 *
 * The option list is whatever GET /crm/hotels returns for THIS caller, not a
 * client-side filter over every hotel. The server scopes it: an RM receives
 * their group's hotels and nobody else's. So this picker cannot offer an
 * out-of-scope hotel even if its props were wrong -- and if one were somehow
 * requested, the analytics routes answer 403 rather than filtering to it.
 */
export function HotelPicker({
  scope,
  value,
  onChange,
}: {
  scope: ScopeShape;
  value: string | null;
  onChange: (hotelId: string | null) => void;
}) {
  const { t } = useTranslation();
  const choosable = canChooseHotel(scope);

  // Conditional fetch: SWR skips a null key, so a hotel manager never makes
  // this request at all. Every round trip here is on mobile data.
  const { data } = useSWR(choosable ? 'crm/hotels' : null, () => api.crm.hotels());

  if (!choosable) return null;

  const options = [
    { value: ALL_HOTELS, label: t('common.all') },
    ...(data ?? [])
      .filter((hotel) => hotel.is_active)
      .map((hotel) => ({ value: hotel.id, label: hotel.name, hint: hotel.city })),
  ];

  return (
    <SelectSheet
      label={t('analytics.scope')}
      value={value ?? ALL_HOTELS}
      options={options}
      // '__all__' is a sentinel for "no filter", not a hotel id. Sending it as
      // one would be a 404 at best; mapping it back to null here keeps the
      // sentinel out of every caller and out of the query string.
      onChange={(next) => onChange(next === ALL_HOTELS ? null : next)}
    />
  );
}
