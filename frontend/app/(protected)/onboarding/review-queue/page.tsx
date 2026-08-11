"use client";

import { PageHeader, Card } from "@/components/ui";
import { ReviewQueueTable } from "@/components/onboarding/ReviewQueueTable";
import { useAuth } from "@/hooks/useAuth";

export default function ReviewQueuePage() {
  const { user } = useAuth();
  
  if (!user || user.role === "worker" || user.role === "checker") {
    return <div className="p-8 text-center text-red-500">You do not have permission to view the review queue.</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Review Queue" 
        description="Pending onboarding applications requiring your review."
      />
      <Card>
        <ReviewQueueTable />
      </Card>
    </div>
  );
}
