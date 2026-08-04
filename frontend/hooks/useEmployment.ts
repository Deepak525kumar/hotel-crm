"use client";

import useSWR from "swr";
import { employeesApi } from "@/lib/api";

/** The worker's EmploymentRecord, or `null` if they haven't been onboarded yet (self-scoped for worker, group-scoped for manager, enforced backend-side). */
export function useEmploymentRecord(userId: string | null | undefined) {
  return useSWR(
    userId ? ["employment-record", userId] : null,
    ([, id]) => employeesApi.getByUserId(id),
  );
}

/** A hotel group's org chart (Admin + Regional Manager own-group only, ADR-060). */
export function useOrgChart(hotelGroupId: string | null | undefined) {
  return useSWR(
    hotelGroupId ? ["org-chart", hotelGroupId] : null,
    ([, id]) => employeesApi.getOrgChart(id),
  );
}
