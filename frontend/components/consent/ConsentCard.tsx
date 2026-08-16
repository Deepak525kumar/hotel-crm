"use client";

import { useState } from "react";
import { mutate } from "swr";
import { useConsentStatus } from "@/hooks/useConsent";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { consentApi } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormError,
  Skeleton,
} from "@/components/ui";
import { DAILY_ACCESS_GATE_INSTANCE } from "@/lib/types";
import type { ConsentNotice, ConsentRecord, ConsentStatus } from "@/lib/types";
import { useTranslation } from "react-i18next";

/**
 * Derives the `ConsentStatus` shape a fresh `getStatus()` call would return
 * from the `ConsentRecord` a decision/withdraw call just produced, so the
 * SWR cache can be updated immediately instead of showing stale data for
 * one revalidation round-trip. WITHDRAWN/RENEWED both read as `absent`
 * (RULE-CONSENT-06's discriminated-result contract; a withdrawal is never
 * itself a "declined" state) — mirrors ConsentService.checkStatus()'s own
 * mapping exactly, so this can never drift into showing a status the
 * backend wouldn't actually return next.
 */
function statusFromRecord(record: ConsentRecord): ConsentStatus {
  if (record.decision === "GRANTED") {
    return { status: "granted", notice_version: record.notice_version, decided_at: record.decided_at };
  }
  if (record.decision === "DECLINED") {
    return { status: "declined", notice_version: record.notice_version, decided_at: record.decided_at };
  }
  return { status: "absent" };
}

/**
 * SPEC-CONSENT-001@0.2.0 FROZEN (ADR-015/ADR-037, GD-17): the daily GDPR
 * access-gate consent instance — self-scoped end to end (worker_id is
 * always the authenticated caller, never client-supplied), so this needs no
 * role gate beyond being authenticated. No route or middleware anywhere in
 * the backend currently blocks app access on this decision (checked
 * `backend/src/middleware` and every module's own service) — this card is a
 * self-service record/decision surface, not an access-blocking wall, since
 * the backend itself doesn't enforce one today. `notice_content` below is
 * the backend's own placeholder legal text (ConsentService.ts:
 * "legal content pending Zirove/DPO authorship"), rendered verbatim — not
 * something this component fabricates or finalizes.
 */
export function ConsentCard() {
  const { t } = useTranslation();
  const { data: status, isLoading, error } = useConsentStatus(DAILY_ACCESS_GATE_INSTANCE);
  const [notice, setNotice] = useState<ConsentNotice | null>(null);
  const fetchNotice = useAsyncAction();
  const decide = useAsyncAction();
  const withdraw = useAsyncAction();

  // Seeds the SWR cache with the status the record we already have implies,
  // then revalidates in the background — avoids a stale-status flash for
  // the one round-trip a plain revalidate-only mutate() would otherwise
  // show (e.g. "Withdraw" still visible right after a successful withdraw).
  const applyRecord = (record: ConsentRecord) =>
    mutate(["consent-status", DAILY_ACCESS_GATE_INSTANCE], statusFromRecord(record));

  const onShowNotice = () =>
    fetchNotice.run(() => consentApi.requestNotice(DAILY_ACCESS_GATE_INSTANCE), {
      onSuccess: (result) => setNotice(result),
    });

  const onDecide = (decision: "GRANTED" | "DECLINED") => {
    if (!notice) return;
    decide
      .run(
        () =>
          consentApi.recordDecision({
            consent_instance: DAILY_ACCESS_GATE_INSTANCE,
            decision,
            notice_version: notice.notice_version,
          }),
        { key: decision },
      )
      .then((record) => {
        setNotice(null);
        if (record) applyRecord(record);
      });
  };

  const onWithdraw = () =>
    withdraw.run(() => consentApi.withdraw(DAILY_ACCESS_GATE_INSTANCE)).then((record) => {
      if (record) applyRecord(record);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("consent.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="py-6 text-center text-sm text-red-600 dark:text-red-400">
            {t("consent.loadOneFailed")}
          </p>
        ) : isLoading ? (
          <Skeleton className="h-5 w-full" />
        ) : status?.status === "granted" ? (
          <div className="flex items-center justify-between gap-4">
            <div>
              <Badge tone="success">{t("status.granted")}</Badge>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Decided {formatDateTime(status.decided_at)} · notice {status.notice_version}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onWithdraw}
              loading={withdraw.pending}
            >
              {t("consent.withdraw")}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {status?.status === "declined" && (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                You previously declined this notice
                {status.decided_at && ` on ${formatDateTime(status.decided_at)}`}. You can
                review it again below.
              </p>
            )}

            {!notice ? (
              <Button
                variant="outline"
                onClick={onShowNotice}
                loading={fetchNotice.pending}
              >
                {t("consent.reviewNotice")}
              </Button>
            ) : (
              <div className="space-y-3 rounded-md border border-gray-200 p-4 dark:border-gray-800">
                <p className="text-xs text-gray-500 dark:text-gray-400">Notice version: {notice.notice_version}</p>
                <p
                  dir={notice.rtl ? "rtl" : "ltr"}
                  className="text-sm text-gray-700 dark:text-gray-300"
                >
                  {notice.notice_content}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => onDecide("GRANTED")}
                    loading={decide.isPending("GRANTED")}
                    disabled={decide.isPending("DECLINED")}
                  >
                    {t("consent.grant")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onDecide("DECLINED")}
                    loading={decide.isPending("DECLINED")}
                    disabled={decide.isPending("GRANTED")}
                  >
                    {t("consent.decline")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <FormError>{fetchNotice.error ?? decide.error ?? withdraw.error}</FormError>
      </CardContent>
    </Card>
  );
}
