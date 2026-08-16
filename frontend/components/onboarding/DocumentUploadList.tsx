"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { documentsApi } from "@/lib/api";
import { DocumentUploadItem } from "./DocumentUploadItem";
import type { DocumentCategory, WorkerDocument } from "@/lib/types";
import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface DocumentUploadListProps {
  workerId: string;
  workPermitRequired?: boolean;
  disabled?: boolean;
  /**
   * Include the signed-contract row. On by default for the applicant's own
   * checklist and the reviewer's view — the contract is part of what a
   * reviewer needs to see, not a separate surface they have to go find.
   */
  includeContract?: boolean;
}

const REQUIRED_CATEGORIES: { id: DocumentCategory; label: string; description: string }[] = [
  { id: "TAX_NUMBER", label: "Tax Number (Steuer-ID)", description: "Official document showing your tax identification number" },
  { id: "SOCIAL_SECURITY_NUMBER", label: "Social Security Number", description: "Proof of social security registration (Sozialversicherungsnummer)" },
  { id: "HEALTH_INSURANCE", label: "Health Insurance Certificate", description: "Confirmation of membership from your health insurance provider" },
  { id: "ID_CARD", label: "ID Card", description: "Front and back scan of your national ID card" },
  { id: "PASSPORT", label: "Passport", description: "Scan of your valid passport data page" },
  { id: "ADDRESS", label: "Proof of Address", description: "Registration certificate (Meldebescheinigung) or recent utility bill" },
];

const CONTRACT_CATEGORY: { id: DocumentCategory; label: string; description: string } = {
  id: "CONTRACT_SCAN",
  label: "Signed Contract",
  description: "Download your contract, sign it, then upload the signed copy here",
};

export function DocumentUploadList({
  workerId,
  workPermitRequired = false,
  disabled = false,
  includeContract = true,
}: DocumentUploadListProps) {
  const { t } = useTranslation();
  const { data: completeness, isLoading, error, mutate } = useSWR(
    `/documents/workers/${workerId}/documents/completeness?work_permit_required=${workPermitRequired}`,
    () => documentsApi.completeness(workerId, workPermitRequired)
  );

  // The actual uploaded files, so each row can link to the real document.
  // Previously this component fetched ONLY the completeness booleans, which
  // is why a reviewer saw green ticks but could not open a single file —
  // there was no document id or URL anywhere in the data it had.
  //
  // Failure here is deliberately non-fatal and does not gate rendering: the
  // checklist still works from `completeness` alone, just without view
  // links. A reviewer seeing an un-clickable checklist beats one seeing a
  // hard error because presigned-URL generation happened to be unavailable.
  const { data: documents, mutate: mutateDocs } = useSWR<WorkerDocument[]>(
    ["worker-documents", workerId],
    () => documentsApi.list(workerId),
  );

  const latestByCategory = useMemo(() => {
    const map = new Map<string, WorkerDocument>();
    // The API returns newest-first (created_at desc), so the first hit per
    // category is the current one — the same "newest wins" rule the
    // completeness check and the reviewer both mean by "the document for
    // this category".
    for (const doc of documents ?? []) {
      if (!map.has(doc.category)) map.set(doc.category, doc);
    }
    return map;
  }, [documents]);

  const categories = useMemo(() => {
    const list = [...REQUIRED_CATEGORIES];
    if (workPermitRequired) {
      list.push({
        id: "WORK_PERMIT",
        label: "Work Permit",
        description: "Valid residence and work permit for non-EU citizens",
      });
    }
    if (includeContract) list.push(CONTRACT_CATEGORY);
    return list;
  }, [workPermitRequired, includeContract]);

  if (error) {
    return (
      <div className="p-4 text-red-600 bg-red-50 border-b border-red-100 flex items-center gap-2">
        <AlertCircle className="w-5 h-5" />
        {t("documents.statusLoadFailed")}
      </div>
    );
  }

  if (isLoading) {
    return <div className="p-8 text-center text-gray-500">{t("onboarding.loadingRequirements")}</div>;
  }

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800">
      {categories.map((cat) => {
        // Optional-chain BOTH levels: `completeness` may be undefined while
        // SWR is revalidating, and a defensive read of `categories` avoids the
        // crash class this line previously caused (see DocumentCompleteness's
        // note in lib/types.ts).
        const isUploaded = completeness?.categories?.[cat.id] === true;
        return (
          <DocumentUploadItem
            key={cat.id}
            category={cat.id}
            label={cat.label}
            description={cat.description}
            workerId={workerId}
            isUploaded={isUploaded}
            document={latestByCategory.get(cat.id) ?? null}
            disabled={disabled}
            onUploadSuccess={() => {
              mutate();
              mutateDocs();
            }}
          />
        );
      })}
    </div>
  );
}
