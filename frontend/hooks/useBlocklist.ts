"use client";

import useSWR from "swr";
import { employeesApi } from "@/lib/api";

/** Lists a hotel's employee blocklist entries (hotel-scoped via `checkHotelAccess()`, enforced backend-side). */
export function useHotelBlocklist(hotelId: string | null | undefined) {
  return useSWR(
    hotelId ? ["blocklist", hotelId] : null,
    ([, id]) => employeesApi.listBlocklist(id),
  );
}
