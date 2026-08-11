"use client";

import { useAuth } from "@/hooks/useAuth";
import { PageHeader, Card, Badge, Button, EmptyState } from "@/components/ui";
import { employeesApi } from "@/lib/api";
import useSWR from "swr";
import { DocumentUploadList } from "@/components/onboarding/DocumentUploadList";
import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { useState } from "react";
import { mutate } from "swr";

export default function MyOnboardingPage() {
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  // Fetch employment record
  const { data: record, isLoading, error } = useSWR(
    user?.id ? `/employees/by-user/${user.id}` : null,
    () => employeesApi.getByUserId(user!.id)
  );

  if (isLoading) return <div className="p-8 text-center text-gray-500">Loading your onboarding record...</div>;
  if (error) return <div className="p-8 text-center text-red-500">Failed to load onboarding record.</div>;

  if (!record) {
    return (
      <div className="space-y-6">
        <PageHeader title="My Onboarding" />
        <EmptyState
          title="No onboarding record found"
          description="Your onboarding record has not been created yet. Please contact your manager."
        />
      </div>
    );
  }

  const isSubmitted = !!record.submitted_for_review_at;
  const isRejected = record.status === "REJECTED";
  const isActive = record.status === "ACTIVE";

  const handleSubmit = async () => {
    try {
      setSubmitting(true);
      await employeesApi.submitForReview(record.employee_id);
      await mutate(`/employees/by-user/${user!.id}`);
    } catch {
      alert("Failed to submit for review. Ensure all required documents are uploaded.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader 
        title={
          <div className="flex items-center gap-4">
            My Onboarding
            <Badge color={isActive ? "green" : isRejected ? "red" : isSubmitted ? "blue" : "gray"}>
              {isActive ? "Active" : isRejected ? "Rejected" : isSubmitted ? "Under Review" : "Pending Documents"}
            </Badge>
          </div>
        }
        description={
          isActive ? "Your onboarding is complete. Welcome to the team!" :
          isRejected ? "Your application was rejected. Please review your documents and contact your manager." :
          isSubmitted ? "Your application is under review by your manager." :
          "Complete your required documentation to activate your account."
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card title="Required Documents">
            <div className="p-4 border-b border-gray-100 dark:border-gray-800">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Please upload all required documents listed below. Once all documents are uploaded, you can submit your application for review.
              </p>
            </div>
            <DocumentUploadList 
              workerId={user!.id} 
              workPermitRequired={record.work_permit_required}
              disabled={isSubmitted || isActive} 
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Application Status">
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-full ${isSubmitted || isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-medium">Documents Uploaded</div>
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
                  <div className="font-medium">Manager Review</div>
                  <div className="text-xs text-gray-500">
                    {isActive ? "Approved" : isSubmitted ? `Submitted ${formatDateTime(record.submitted_for_review_at!)}` : "Awaiting submission"}
                  </div>
                </div>
              </div>
              
              {isRejected && (
                <div className="flex items-center gap-3 mt-4 p-3 bg-red-50 text-red-700 rounded-md text-sm border border-red-100">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <div>
                    <span className="font-semibold block">Application Rejected</span>
                    {record.deleted_reason || "Please review your documents and contact your manager."}
                  </div>
                </div>
              )}

              {!isSubmitted && !isActive && !isRejected && (
                <div className="pt-4 mt-4 border-t border-gray-100 dark:border-gray-800">
                  <Button 
                    className="w-full justify-center" 
                    onClick={handleSubmit}
                    loading={submitting}
                  >
                    Submit for Review
                  </Button>
                  <p className="text-xs text-center text-gray-500 mt-2">
                    Ensure all documents are marked as complete before submitting.
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
