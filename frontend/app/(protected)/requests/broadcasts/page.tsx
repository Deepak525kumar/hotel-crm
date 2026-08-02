"use client";

import { useState } from "react";
import Link from "next/link";
import { useBroadcasts } from "@/hooks/useWorkRequests";
import { JobDispatchPhase2WriteGate } from "@/components/auth/RoleGate";
import { WorkRequestStatusBadge } from "@/components/work-requests/StatusBadge";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Pager,
  PageHeader,
  Table,
  THead,
  TBody,
  TableSkeleton,
  TR,
  TH,
  TD,
  TextLink,
} from "@/components/ui";

const PER_PAGE = 20;
const COLUMNS = 4;

export default function BroadcastsPage() {
  const [page, setPage] = useState(1);

  const { broadcasts, isLoading, error, hasNext } = useBroadcasts({
    page,
    per_page: PER_PAGE,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Broadcasts"
        description="Shifts raised to every eligible worker at once. First accept per skill wins."
        actions={
          <JobDispatchPhase2WriteGate>
            <Link href="/requests/broadcasts/new">
              <Button>New broadcast</Button>
            </Link>
          </JobDispatchPhase2WriteGate>
        }
      />

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="px-6 py-10 text-center text-sm text-red-600">
              Failed to load broadcasts. Please try again.
            </div>
          ) : (
            <Table aria-label="Broadcasts">
              <THead>
                <tr>
                  <TH>Shift date</TH>
                  <TH>Time</TH>
                  <TH>Skills</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              {isLoading ? (
                <TableSkeleton columns={COLUMNS} />
              ) : broadcasts.length === 0 ? (
                <TBody>
                  <tr>
                    <TD colSpan={COLUMNS} className="p-0">
                      <EmptyState
                        title="No broadcasts found"
                        description="Raise a broadcast to open a shift to every eligible worker."
                      />
                    </TD>
                  </tr>
                </TBody>
              ) : (
                <TBody>
                  {broadcasts.map((wr) => (
                    <TR key={wr.id}>
                      <TD className="font-medium">
                        <TextLink href={`/requests/broadcasts/${wr.id}`} className="block">
                          {wr.shift_date}
                        </TextLink>
                      </TD>
                      <TD>
                        {wr.shift_start_time}–{wr.shift_end_time}
                      </TD>
                      <TD>
                        {(wr.skill_slots ?? [])
                          .map((s) => `${s.confirmed_count}/${s.headcount} ${s.skill}`)
                          .join(", ")}
                      </TD>
                      <TD>
                        <WorkRequestStatusBadge status={wr.status} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              )}
            </Table>
          )}
        </CardContent>
      </Card>

      <Pager page={page} hasNext={hasNext} onPageChange={setPage} disabled={isLoading} />
    </div>
  );
}
