"use client";

import useSWR from "swr";
import { consentApi } from "@/lib/api";

/** The caller's own status for one consent instance (self-scoped, enforced backend-side). */
export function useConsentStatus(consentInstance: string) {
  return useSWR(["consent-status", consentInstance], ([, instance]) =>
    consentApi.getStatus(instance),
  );
}
