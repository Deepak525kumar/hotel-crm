"use client";

import { useState } from "react";
import { useLeaderboard } from "@/hooks/useAnalytics";
import { useHotels } from "@/hooks/useHotels";
import { RoleGate } from "@/components/auth/RoleGate";
import { LeaderboardTable } from "@/components/analytics/LeaderboardTable";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  Select,
} from "@/components/ui";

function LeaderboardDashboard() {
  const { t } = useTranslation();
  const [hotelId, setHotelId] = useState("");
  const scope = hotelId || undefined;

  const { entries, isLoading: leaderboardLoading, error: leaderboardError } =
    useLeaderboard(scope);
  const { hotels } = useHotels({ is_active: "true", limit: 100 });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("nav.leaderboard") || "Leaderboard"}
        description={t("analytics.leaderboardDescription") || "View top performing workers"}
        actions={
          <div className="w-full sm:w-64">
            <Select
              aria-label={t("analytics.scope")}
              value={hotelId}
              onChange={(e) => setHotelId(e.target.value)}
            >
              <option value="">{t("filters.allHotels")}</option>
              {hotels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("users.leaderboard") || "Worker Leaderboard"}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <LeaderboardTable
            entries={entries}
            isLoading={leaderboardLoading}
            error={leaderboardError}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default function LeaderboardPage() {
  const { t } = useTranslation();
  return (
    <RoleGate
      allow={["manager", "regional_manager", "admin"]}
      fallback={
        <Card>
          <CardContent className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
            {t("analytics.noPermission") || "You do not have permission to view the leaderboard."}
          </CardContent>
        </Card>
      }
    >
      <LeaderboardDashboard />
    </RoleGate>
  );
}
