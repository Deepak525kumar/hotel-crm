"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { consentApi } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useConsentStatus } from "@/hooks/useConsent";
import { Button } from "@/components/ui/Button";
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

  const { data: status, error: statusError, isLoading, mutate } = useConsentStatus(DAILY_ACCESS_GATE);

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

  // Fail open for admins, while resolving, AND when the status read itself
  // failed. Matching useOnboardingLockout's posture: never blank the app on an
  // unresolved read. The server is the real gate and still refuses every gated
  // call, so this is not a bypass.
  //
  // `statusError` is the case this previously got wrong: on a failed read
  // SWR leaves `data` undefined and `isLoading` false, so it fell through to
  // the wall. That also silently defeated the documented kill switch -- with
  // FEATURE_CONSENT_GATE off the API stops gating at once, but a client that
  // walls on its own consent read keeps every non-admin in front of a notice
  // they no longer need, and if the consent endpoints are what broke, that
  // wall cannot be dismissed.
  if (isAdmin || isLoading || granted || statusError) return <>{children}</>;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6" role="alertdialog" aria-modal="true">
      <h1 className="text-xl font-semibold">
        {declined ? t("consent.lockedTitle") : t("consent.gateTitle")}
      </h1>

      <p className="text-sm text-gray-600 dark:text-gray-400">
        {declined ? t("consent.lockedBody") : t("consent.gateBody")}
      </p>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {notice ? (
        <div className="rounded-md border border-gray-200 p-4 dark:border-gray-800">
          <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
            {notice.notice_version}
          </p>
          {/* notice_content is plain text server-side, rendered verbatim.
              RTL applies to the notice text only, not the app chrome. */}
          <p className="whitespace-pre-wrap text-sm" dir={notice.rtl ? "rtl" : undefined}>
            {notice.notice_content}
          </p>

          {/* The shared Button, not raw Tailwind: the design system owns the
              variants, and hand-rolled classes rendered the primary action
              unstyled while the secondary one kept its border -- making
              "Decline" look like the emphasised choice on a GDPR consent
              screen. Caught by screenshotting the real page. */}
          <div className="mt-4 flex gap-3">
            <Button
              onClick={() => void decide("GRANTED")}
              loading={deciding === "GRANTED"}
              disabled={deciding !== null}
            >
              {t("consent.grant")}
            </Button>
            <Button
              variant="outline"
              onClick={() => void decide("DECLINED")}
              loading={deciding === "DECLINED"}
              disabled={deciding !== null}
            >
              {t("consent.decline")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
