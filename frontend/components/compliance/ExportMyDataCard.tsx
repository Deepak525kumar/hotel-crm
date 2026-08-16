"use client";

import { useState } from "react";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { complianceApi } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, FormError } from "@/components/ui";
import type { SubjectRightsBundle } from "@/lib/types";
import { useTranslation } from "react-i18next";

function downloadJson(bundle: SubjectRightsBundle) {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `subject-rights-export-${bundle.worker_id}-${bundle.generated_at.slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function SourceRow({
  label,
  result,
  count,
}: {
  label: string;
  result: { status: "ok" | "unavailable" };
  count: number | null;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center justify-between gap-4 border-b border-gray-100 py-3 last:border-b-0 dark:border-gray-800">
      <p className="text-sm text-gray-700 dark:text-gray-300">{label}</p>
      {result.status === "unavailable" ? (
        <Badge tone="warning">{t("status.unavailable")}</Badge>
      ) : (
        <Badge tone="neutral">{count} {count === 1 ? "record" : "records"}</Badge>
      )}
    </li>
  );
}

/**
 * SPEC-COMPLIANCE-001@0.1.0 REVIEW (IF-COMPLIANCE-FulfilSubjectRightsRequest,
 * REQ-COMPLIANCE-011): GDPR subject-rights export — the caller's own
 * documents, consent history, and audit trail, bundled server-side.
 * Self-scoped end to end (no worker_id is ever sent; the backend derives it
 * from the session), so no role gate beyond authentication. Each source
 * reports its own ok/unavailable status independently (OD-COMPLIANCE-005:
 * one source failing does not fail the whole export) — rendered as-is, not
 * collapsed into a single pass/fail state. Retention is deliberately absent
 * from the bundle (it has no per-worker export interface) and is not shown
 * here as a fourth source.
 */
export function ExportMyDataCard() {
  const { t } = useTranslation();
  const [bundle, setBundle] = useState<SubjectRightsBundle | null>(null);
  const request = useAsyncAction();

  const onRequest = () =>
    request.run(() => complianceApi.exportMyData(), {
      onSuccess: (result) => setBundle(result),
    });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{t("users.exportMyData")}</CardTitle>
        <Button size="sm" variant="outline" onClick={onRequest} loading={request.pending}>
          {bundle ? "Refresh" : "Request export"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!bundle ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("compliance.exportDescription")}
          </p>
        ) : (
          <>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Generated {formatDateTime(bundle.generated_at)}
            </p>
            <ul>
              <SourceRow
                label={t("documents.title")}
                result={bundle.documents}
                count={bundle.documents.data?.length ?? null}
              />
              <SourceRow
                label={t("consent.history")}
                result={bundle.consent_history}
                count={bundle.consent_history.data?.total ?? null}
              />
              <SourceRow
                label={t("consent.auditTrail")}
                result={bundle.audit_trail}
                count={bundle.audit_trail.data?.total ?? null}
              />
            </ul>
            <Button size="sm" onClick={() => downloadJson(bundle)}>
              {t("compliance.downloadJson")}
            </Button>
          </>
        )}

        <FormError>{request.error}</FormError>
      </CardContent>
    </Card>
  );
}
