"use client";

// "use client" added with i18n extraction (2026-08-16): this component now
// calls the useTranslation hook. It was already rendered exclusively from
// client components and has no server-only dependency, so the directive
// makes explicit what was already true rather than moving a boundary.
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
import { formatScore } from "@/lib/format";
import type { LeaderboardEntry } from "@/lib/types";
import { useTranslation } from "react-i18next";

export interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  isLoading?: boolean;
  error?: unknown;
  /** Cap the number of rows shown (e.g. top 5 on the dashboard). */
  limit?: number;
}

/** Ranked worker table shared by the analytics page and dashboard preview. */
export function LeaderboardTable({
  entries,
  isLoading,
  error,
  limit,
}: LeaderboardTableProps) {
  const { t } = useTranslation();
  const rows = limit ? entries.slice(0, limit) : entries;
  const columns = 5;

  if (error) {
    return (
      <div className="px-6 py-10 text-center text-sm text-red-600 dark:text-red-400">
        Failed to load the leaderboard.
      </div>
    );
  }

  return (
    <Table aria-label={t("users.leaderboard")}>
      <THead>
        <tr>
          <TH className="w-12">#</TH>
          <TH>{t("fields.worker")}</TH>
          <TH className="text-end">{t("status.completed")}</TH>
          <TH className="text-end">{t("common.total")}</TH>
          <TH className="text-end">{t("analytics.avgRating")}</TH>
        </tr>
      </THead>
      {isLoading ? (
        <TableSkeleton columns={columns} />
      ) : rows.length === 0 ? (
        <TBody>
          <tr>
            <TD colSpan={columns} className="p-0">
              <EmptyState
                title="No ranked workers yet"
                description="Rankings appear once workers complete assignments."
              />
            </TD>
          </tr>
        </TBody>
      ) : (
        <TBody>
          {rows.map((e) => (
            <TR key={e.worker_id}>
              <TD className="font-medium text-gray-500 dark:text-gray-400">{e.position}</TD>
              <TD className="font-medium">{e.name}</TD>
              <TD className="text-end">{e.completed_tasks}</TD>
              <TD className="text-end">{e.total_tasks}</TD>
              <TD className="text-end">{formatScore(e.average_rating, 2)}</TD>
            </TR>
          ))}
        </TBody>
      )}
    </Table>
  );
}
