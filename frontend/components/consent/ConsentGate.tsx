"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { consentApi } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useConsentStatus } from "@/hooks/useConsent";
import type { ConsentNotice } from "@/lib/types";

const DAILY_ACCESS_GATE = "daily-access-gate";

/**
 * RULE-CONSENT-01 daily access gate, web half.
 *
 * The server is the real gate (backend middleware/consentGate.ts returns 403
 * CONSENT_REQUIRED on every non-exempt route). This component exists so the
 * user sees the notice rather than a page full of failed requests -- it is UX
 * for an enforcement that happens server-side, not the enforcement itself.
 *
 * Renders a blocking panel rather than redirecting to /consent: a redirect is
 * escapable by typing a URL, which would visually contradict the API's actual
 * answer. Admins are never gated, matching the server's own exemption.
 *
 * On a decline the user still gets an accept path -- RULE-CONSENT-02 makes a
 * later GRANT supersede the decline, so a mis-click must not cost a work day.
 */
export function ConsentGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const { data: status, isLoading, mutate } = useConsentStatus(DAILY_ACCESS_GATE);

  const [notice, setNotice] = useState<ConsentNotice | null>(null);
  const [deciding, setDeciding] = useState<"GRANTED" | "DECLINED" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const granted = status?.status === "granted";
  const declined = status?.status === "declined";
  const needsNotice = !isAdmin && !isLoading && !granted;

  useEffect(() => {
    if (!needsNotice || notice) return;
    let cancelled = false;
    void consentApi
      .requestNotice(DAILY_ACCESS_GATE)
      .then((n) => {
        if (!cancelled) setNotice(n);
      })
      .catch(() => {
        if (!cancelled) setError(t("consent.gateLoadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [needsNotice, notice, t]);

  const decide = useCallback(
    async (decision: "GRANTED" | "DECLINED") => {
      if (!notice) return;
      setDeciding(decision);
      setError(null);
      try {
        await consentApi.recordDecision({
          consent_instance: DAILY_ACCESS_GATE,
          decision,
          notice_version: notice.notice_version,
        });
        // Revalidate rather than assuming: the server decides what today's
        // status is, and a stale-version decision is rejected server-side.
        await mutate();
      } catch {
        setError(t("consent.couldNotRecordDecision"));
      } finally {
        setDeciding(null);
      }
    },
    [notice, mutate, t],
  );

  // Fail open while resolving, and for admins. Matching useOnboardingLockout's
  // posture: never blank the app on an unresolved read. The server still
  // refuses every gated call, so this is not a bypass.
  if (isAdmin || isLoading || granted) return <>{children}</>;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6" role="alertdialog" aria-modal="true">
      <h1 className="text-xl font-semibold">
        {declined ? t("consent.lockedTitle") : t("consent.gateTitle")}
      </h1>

      <p className="text-sm text-muted-foreground">
        {declined ? t("consent.lockedBody") : t("consent.gateBody")}
      </p>

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {notice ? (
        <div className="rounded-lg border p-4">
          <p className="mb-2 text-xs text-muted-foreground">
            {notice.notice_version}
          </p>
          {/* notice_content is plain text server-side, rendered verbatim.
              RTL applies to the notice text only, not the app chrome. */}
          <p className="whitespace-pre-wrap text-sm" dir={notice.rtl ? "rtl" : undefined}>
            {notice.notice_content}
          </p>

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={() => void decide("GRANTED")}
              disabled={deciding !== null}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {t("consent.grant")}
            </button>
            <button
              type="button"
              onClick={() => void decide("DECLINED")}
              disabled={deciding !== null}
              className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              {t("consent.decline")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
