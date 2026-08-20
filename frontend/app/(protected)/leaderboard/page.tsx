"use client";

import { useState } from "react";
import { useLeaderboard, usePeerLeaderboard } from "@/hooks/useAnalytics";
import { useHotels } from "@/hooks/useHotels";
import { RoleGate } from "@/components/auth/RoleGate";
import { LeaderboardTable } from "@/components/analytics/LeaderboardTable";
import { PeerLeaderboardTable } from "@/components/analytics/PeerLeaderboardTable";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  Select,
} from "@/components/ui";

/**
 * Admin/manager/regional_manager view: /analytics/leaderboard, unscoped
 * (or scoped by the hotel picker below), manager-facing fields included.
 * Unchanged from before this file grew a worker/checker branch.
 */
function ManagerLeaderboardView() {
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

/**
 * Worker/checker view (ADR-067): /quality/leaderboard, scoped server-side to
 * the caller's own hotel group, no manager-facing fields, no hotel picker --
 * there is nothing to pick, scope is not the caller's to widen.
 *
 * This is the fix for the nav entry that has shown "Leaderboard" to worker
 * and checker since it was added with `roles: [..., "worker", "checker"]`,
 * while the page itself kept the ORIGINAL manager-only RoleGate and blocked
 * both roles with a permission-denied message -- and even without that
 * block, the page was still calling /analytics/leaderboard, which 403s for
 * these two roles by design (see useAnalytics.ts's useLeaderboard comment).
 * Mobile's worker and checker apps already call the correct endpoint; this
 * brings the web app to the same place.
 */
function PeerLeaderboardView() {
  const { t } = useTranslation();
  const { entries, isLoading, error } = usePeerLeaderboard();

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("nav.leaderboard") || "Leaderboard"}
        description={t("analytics.peerLeaderboardDescription")}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("users.leaderboard") || "Worker Leaderboard"}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <PeerLeaderboardTable entries={entries} isLoading={isLoading} error={error} />
        </CardContent>
      </Card>
    </div>
  );
}

export default function LeaderboardPage() {
  return (
    <>
      <RoleGate allow={["manager", "regional_manager", "admin"]}>
        <ManagerLeaderboardView />
      </RoleGate>
      <RoleGate allow={["worker", "checker"]}>
        <PeerLeaderboardView />
      </RoleGate>
    </>
  );
}
