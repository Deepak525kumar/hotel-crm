"use client";

import { PageHeader, Card, CardContent } from "@/components/ui";
import { RoleGate } from "@/components/auth/RoleGate";
import { ReviewQueueTable } from "@/components/onboarding/ReviewQueueTable";
import { useTranslation } from "react-i18next";

export default function ReviewQueuePage() {
  const { t } = useTranslation();
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
          title={t("nav.reviewQueue")}
          description={t("onboarding.reviewQueueDescription")}
        />
        <ReviewQueueTable />
      </div>
    </RoleGate>
  );
}
