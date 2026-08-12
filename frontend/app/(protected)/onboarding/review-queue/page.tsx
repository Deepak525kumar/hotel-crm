"use client";

import { PageHeader, Card, CardContent } from "@/components/ui";
import { RoleGate } from "@/components/auth/RoleGate";
import { ReviewQueueTable } from "@/components/onboarding/ReviewQueueTable";

export default function ReviewQueuePage() {
  return (
    <RoleGate
      allow={["manager", "regional_manager", "admin"]}
      fallback={
        <Card>
          <CardContent className="text-sm text-gray-500 dark:text-gray-400">
            You do not have permission to view the review queue.
          </CardContent>
        </Card>
      }
    >
      <div className="space-y-6">
        <PageHeader
          title="Review queue"
          description="Applications submitted by your team, awaiting your review."
        />
        <ReviewQueueTable />
      </div>
    </RoleGate>
  );
}
