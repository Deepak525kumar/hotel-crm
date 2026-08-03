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
