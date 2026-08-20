"use client";

import {
  EmptyState,
  Table,
  TBody,
  TableSkeleton,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import { formatPercent, formatScore } from "@/lib/format";
import { RatingTierBadge } from "@/components/analytics/RatingTierBadge";
import type { QualityLeaderboardEntry } from "@/lib/types";
import { useTranslation } from "react-i18next";

export interface PeerLeaderboardTableProps {
  entries: QualityLeaderboardEntry[];
  isLoading?: boolean;
  error?: unknown;
}

/**
 * ADR-067's group-scoped board, for worker/checker viewers. Deliberately a
 * separate component from LeaderboardTable rather than a shared one with
 * branches: the row shapes genuinely differ (this one has no `position` or
 * manager-facing `email`, and carries fields -- completion/on-time rate,
 * absences -- the manager view doesn't show here), and a single component
 * juggling both would need to know which endpoint its data came from.
 *
 * Rank is the row's position in the (already server-sorted, by
 * average_score desc) array -- the API does not return a `position` field
 * for this endpoint, unlike /analytics/leaderboard's.
 */
export function PeerLeaderboardTable({
  entries,
  isLoading,
  error,
}: PeerLeaderboardTableProps) {
  const { t } = useTranslation();
  const columns = 6;

  if (error) {
    return (
      <div className="px-6 py-10 text-center text-sm text-red-600 dark:text-red-400">
        {t("analytics.leaderboardLoadFailed")}
      </div>
    );
  }

  return (
    <Table aria-label={t("users.leaderboard")}>
      <THead>
        <tr>
          <TH className="w-12">#</TH>
          <TH>{t("fields.worker")}</TH>
          <TH>{t("fields.hotel")}</TH>
          <TH className="text-end">{t("analytics.avgRating")}</TH>
          <TH className="text-end">{t("analytics.completionRate")}</TH>
          <TH>{t("analytics.tier")}</TH>
        </tr>
      </THead>
      {isLoading ? (
        <TableSkeleton columns={columns} />
      ) : entries.length === 0 ? (
        <TBody>
          <tr>
            <TD colSpan={columns} className="p-0">
              <EmptyState
                title={t("analytics.noRankedWorkers")}
                description={t("analytics.noRankedWorkersDescription")}
              />
            </TD>
          </tr>
        </TBody>
      ) : (
        <TBody>
          {entries.map((e, i) => (
            <TR key={e.worker_id}>
              <TD className="font-medium text-gray-500 dark:text-gray-400">{i + 1}</TD>
              <TD className="font-medium">
                {e.worker.first_name} {e.worker.last_name}
              </TD>
              <TD className="text-gray-500 dark:text-gray-400">
                {e.worker.employment_record?.primary_hotel?.name ?? "—"}
              </TD>
              <TD className="text-end">
                {/* total_ratings === 0 is a real, reachable state: an active
                    worker with shifts logged but no rating yet has
                    average_score 0 from the aggregate's own default
                    (agg._avg.score ?? 0), which reads as a failing score
                    rather than "not yet rated". deriveRatingTier already
                    treats this as "no tier" (renders no badge); the score
                    column needs the same treatment for the same reason. */}
                {e.total_ratings > 0 ? formatScore(e.average_score, 2) : "—"}
              </TD>
              <TD className="text-end">{formatPercent(e.completion_rate * 100)}</TD>
              <TD>
                <RatingTierBadge tier={e.rating_tier} />
              </TD>
            </TR>
          ))}
        </TBody>
      )}
    </Table>
  );
}
