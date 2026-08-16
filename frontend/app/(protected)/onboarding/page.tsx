"use client";

import { useAuth } from "@/hooks/useAuth";
import { PageHeader, Card, Badge, Button, EmptyState } from "@/components/ui";
import { employeesApi } from "@/lib/api";
import { useEmploymentRecord } from "@/hooks/useEmployment";
import { useMyOnboarding } from "@/hooks/useMyOnboarding";
import { useWorkerContract } from "@/hooks/useContract";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { DocumentUploadList } from "@/components/onboarding/DocumentUploadList";
import { MyContractCard } from "@/components/onboarding/MyContractCard";
import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export default function MyOnboardingPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Shares BOTH the SWR cache key and the status vocabulary with the sidebar
  // entry and the dashboard callout (useMyOnboarding wraps this same
  // useEmploymentRecord hook). Previously this page called useSWR directly with
  // a string key `/employees/by-user/:id` while `useEmploymentRecord` keyed on
  // the tuple ["employment-record", id] — two caches for one resource, so a
  // submit here left the other surfaces showing stale status.
  const { data: record, isLoading, error, mutate: refreshRecord } =
    useEmploymentRecord(user?.id);
  const { label: statusLabel, description: statusDescription, tone: statusTone } = useMyOnboarding();
  const { data: contract } = useWorkerContract(user?.id);
  const isContractExpired = contract?.end_date ? new Date(contract.end_date) < new Date() : false;
  const triggerAction = useAsyncAction();
  
  const handleTriggerReonboarding = () => {
    triggerAction.run(() => employeesApi.triggerReonboarding(record!.employee_id), {
      key: "trigger_reonboarding",
      onSuccess: () => refreshRecord(),
    });
  };

  if (isLoading) return <div className="p-8 text-center text-gray-500">{t("onboarding.loadingRecord")}</div>;
  if (error) return <div className="p-8 text-center text-red-500">{t("onboarding.loadRecordFailed")}</div>;

  if (!record) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("nav.myOnboarding")} />
        <EmptyState
          title={t("onboarding.noRecordFound")}
          description={t("onboarding.noRecordDescription")}
        />
      </div>
    );
  }

  const isSubmitted = !!record.submitted_for_review_at;
  const isRejected = record.status === "REJECTED";
  const isActive = record.status === "ACTIVE";
  // A returning employee (their previous engagement ended and was restored).
  // Their documents are deliberately preserved and are NOT re-collected —
  // re-onboarding checks the contract only (employee-management
  // submitForReview).
  const isReonboarding = (record.employment_cycle ?? 1) > 1;

  const handleSubmit = async () => {
    try {
      setSubmitting(true);
      setSubmitError(null);
      await employeesApi.submitForReview(record.employee_id);
      // Revalidates the shared ["employment-record", userId] key, so the
      // sidebar badge and dashboard callout update with this page.
      await refreshRecord();
    } catch (err) {
      // The backend's message says exactly what is missing (which document,
      // or that the signed contract has not been uploaded yet). The previous
      // fixed alert() replaced all of that with a guess that was wrong for
      // every contract-related failure.
      setSubmitError(
        err instanceof Error && err.message
          ? err.message
          : "Failed to submit for review. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Status label/tone/copy come from useMyOnboarding so this page, the
          sidebar entry and the dashboard callout can never disagree.
          `tone` (not `color`) is Badge's actual prop — `color` was silently
          ignored and leaked to the DOM, so every status rendered grey. */}
      <PageHeader
        title={
          <div className="flex items-center gap-4">
            {t("onboarding.myOnboardingTitle")}
            <Badge tone={statusTone}>{statusLabel}</Badge>
          </div>
        }
        description={statusDescription}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card title={isReonboarding ? "Your Documents" : "Required Documents"}>
            <div className="p-4 border-b border-gray-100 dark:border-gray-800">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {isReonboarding
                  ? "Welcome back — the documents from your previous engagement are still on file and do not need to be uploaded again. Only your contract is re-checked."
                  : "Please upload all required documents listed below. Once all documents are uploaded, you can submit your application for review."}
              </p>
            </div>
            <DocumentUploadList 
              workerId={user!.id} 
              workPermitRequired={record.work_permit_required}
              disabled={isSubmitted || isActive} 
            />
          </Card>

          {/* The contract was previously absent from this page entirely, so an
              applicant never learned they had one to sign — even though
              approval independently requires it. */}
          <MyContractCard workerId={user!.id} />
        </div>

        <div className="space-y-6">
          <Card title={t("onboarding.applicationStatus")}>
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-full ${isSubmitted || isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-medium">{t("onboarding.documentsUploaded")}</div>
                  <div className="text-xs text-gray-500">
                    {isSubmitted || isActive ? "Complete" : "Pending your action"}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-full ${isActive ? 'bg-green-100 text-green-700' : isSubmitted ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-medium">{t("onboarding.managerReview")}</div>
                  <div className="text-xs text-gray-500">
                    {isActive ? "Approved" : isSubmitted ? `Submitted ${formatDateTime(record.submitted_for_review_at!)}` : "Awaiting submission"}
                  </div>
                </div>
              </div>
              
              {isRejected && (
                <div className="flex items-center gap-3 mt-4 p-3 bg-red-50 text-red-700 rounded-md text-sm border border-red-100">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <div>
                    <span className="font-semibold block">{t("onboarding.applicationRejected")}</span>
                    {record.deleted_reason || "Please review your documents and contact your manager."}
                  </div>
                </div>
              )}

              {record.status === "DEACTIVATED" && isContractExpired && (
                <div className="flex items-center gap-3 mt-4 p-3 bg-warning-50 text-warning-700 rounded-md text-sm border border-warning-100">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <div>
                    <span className="font-semibold block">{t("hr.contractExpired")}</span>
                    Your contract has expired. Please start the re-onboarding process to receive and upload a new contract.
                  </div>
                </div>
              )}
              {record.status === "DEACTIVATED" && isContractExpired && (
                <div className="pt-4 mt-4 border-t border-gray-100 dark:border-gray-800">
                  <Button 
                    className="w-full justify-center" 
                    onClick={handleTriggerReonboarding}
                    loading={triggerAction.isPending("trigger_reonboarding")}
                  >
                    {t("onboarding.startReOnboarding")}
                  </Button>
                </div>
              )}
              {!isSubmitted && !isActive && record.status !== "DEACTIVATED" && (
                <div className="pt-4 mt-4 border-t border-gray-100 dark:border-gray-800">
                  <Button 
                    className="w-full justify-center" 
                    onClick={handleSubmit}
                    loading={submitting}
                  >
                    {isRejected ? "Resubmit for Review" : "Submit for Review"}
                  </Button>
                  {submitError && (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">{submitError}</p>
                  )}
                  <p className="text-xs text-center text-gray-500 mt-2">
                    {isReonboarding
                      ? "Sign and upload your contract, then submit to your reviewer."
                      : "Ensure all documents are marked as complete before submitting."}
                  </p>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
