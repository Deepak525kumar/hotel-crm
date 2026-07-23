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
  const rows = limit ? entries.slice(0, limit) : entries;
  const columns = 5;

  if (error) {
    return (
      <div className="px-6 py-10 text-center text-sm text-red-600">
        Failed to load the leaderboard.
      </div>
    );
  }

  return (
    <Table aria-label="Worker leaderboard">
      <THead>
        <tr>
          <TH className="w-12">#</TH>
          <TH>Worker</TH>
          <TH className="text-right">Completed</TH>
          <TH className="text-right">Total</TH>
          <TH className="text-right">Avg rating</TH>
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
              <TD className="font-medium text-gray-500">{e.position}</TD>
              <TD className="font-medium">{e.name}</TD>
              <TD className="text-right">{e.completed_tasks}</TD>
              <TD className="text-right">{e.total_tasks}</TD>
              <TD className="text-right">{formatScore(e.average_rating, 2)}</TD>
            </TR>
          ))}
        </TBody>
      )}
    </Table>
  );
}
