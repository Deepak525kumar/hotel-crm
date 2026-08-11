"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { documentsApi } from "@/lib/api";
import { DocumentUploadItem } from "./DocumentUploadItem";
import type { DocumentCategory } from "@/lib/types";
import { AlertCircle } from "lucide-react";

export interface DocumentUploadListProps {
  workerId: string;
  workPermitRequired?: boolean;
  disabled?: boolean;
}

const REQUIRED_CATEGORIES: { id: DocumentCategory; label: string; description: string }[] = [
  { id: "TAX_NUMBER", label: "Tax Number (Steuer-ID)", description: "Official document showing your tax identification number" },
  { id: "SOCIAL_SECURITY_NUMBER", label: "Social Security Number", description: "Proof of social security registration (Sozialversicherungsnummer)" },
  { id: "HEALTH_INSURANCE", label: "Health Insurance Certificate", description: "Confirmation of membership from your health insurance provider" },
  { id: "ID_CARD", label: "ID Card", description: "Front and back scan of your national ID card" },
  { id: "PASSPORT", label: "Passport", description: "Scan of your valid passport data page" },
  { id: "ADDRESS", label: "Proof of Address", description: "Registration certificate (Meldebescheinigung) or recent utility bill" },
];

export function DocumentUploadList({ workerId, workPermitRequired = false, disabled = false }: DocumentUploadListProps) {
  // We use SWR to fetch document completeness
  const { data: completeness, isLoading, error, mutate } = useSWR(
    `/documents/workers/${workerId}/documents/completeness?work_permit_required=${workPermitRequired}`,
    () => documentsApi.completeness(workerId, workPermitRequired)
  );

  const categories = useMemo(() => {
    const list = [...REQUIRED_CATEGORIES];
    if (workPermitRequired) {
      list.push({ 
        id: "WORK_PERMIT", 
        label: "Work Permit", 
        description: "Valid residence and work permit for non-EU citizens" 
      });
    }
    return list;
  }, [workPermitRequired]);

  if (error) {
    return (
      <div className="p-4 text-red-600 bg-red-50 border-b border-red-100 flex items-center gap-2">
        <AlertCircle className="w-5 h-5" />
        Failed to load document status.
      </div>
    );
  }

  if (isLoading) {
    return <div className="p-8 text-center text-gray-500">Loading document requirements...</div>;
  }

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800">
      {categories.map((cat) => {
        const isUploaded = completeness?.by_category[cat.id] === true;
        return (
          <DocumentUploadItem
            key={cat.id}
            category={cat.id}
            label={cat.label}
            description={cat.description}
            workerId={workerId}
            isUploaded={isUploaded}
            disabled={disabled}
            onUploadSuccess={() => mutate()}
          />
        );
      })}
    </div>
  );
}
