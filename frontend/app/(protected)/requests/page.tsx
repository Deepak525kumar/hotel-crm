"use client";

import { useState } from "react";
import Link from "next/link";
import { useWorkRequests } from "@/hooks/useWorkRequests";
import { StaffingWriteGate } from "@/components/auth/RoleGate";
import { WorkRequestStatusBadge } from "@/components/work-requests/StatusBadge";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Pager,
  PageHeader,
  Select,
  Table,
  THead,
  TBody,
  TableSkeleton,
  TR,
  TH,
  TD,
  TextLink,
} from "@/components/ui";
import type { WorkRequestStatus } from "@/lib/types";

const STATUS_FILTERS = [
  { value: "", label: "All statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "OPEN", label: "Open" },
  { value: "PARTIALLY_FILLED", label: "Partially filled" },
  { value: "FILLED", label: "Filled" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "EXPIRED", label: "Expired" },
];

const PER_PAGE = 20;
const COLUMNS = 5;

export default function WorkRequestsPage() {
  const [status, setStatus] = useState<WorkRequestStatus | "">("");
  const [page, setPage] = useState(1);

  const { requests, isLoading, error, hasNext } = useWorkRequests({
    status: status || undefined,
    page,
    per_page: PER_PAGE,
  });

  const onStatusChange = (next: WorkRequestStatus | "") => {
    setStatus(next);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work requests"
        description="Shifts open for staffing across your hotels."
        actions={
          <StaffingWriteGate>
            <Link href="/requests/new">
              <Button>New request</Button>
            </Link>
          </StaffingWriteGate>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full sm:w-48">
          <Select
            label="Status"
            value={status}
            onChange={(e) => onStatusChange(e.target.value as WorkRequestStatus | "")}
            options={STATUS_FILTERS}
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="px-6 py-10 text-center text-sm text-red-600">
              Failed to load work requests. Please try again.
            </div>
          ) : (
            <Table aria-label="Work requests">
              <THead>
                <tr>
                  <TH>Position</TH>
                  <TH>Shift date</TH>
                  <TH>Time</TH>
                  <TH>Staffing</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              {isLoading ? (
                <TableSkeleton columns={COLUMNS} />
              ) : requests.length === 0 ? (
                <TBody>
                  <tr>
                    <TD colSpan={COLUMNS} className="p-0">
                      <EmptyState
                        title="No work requests found"
                        description={
                          status
                            ? "Try adjusting your filters."
                            : "Create a work request to open a shift for staffing."
                        }
                      />
                    </TD>
                  </tr>
                </TBody>
              ) : (
                <TBody>
                  {requests.map((wr) => (
                    <TR key={wr.id}>
                      <TD className="font-medium">
                        <TextLink
                          href={`/requests/${wr.id}`}
                          className="block"
                        >
                          {wr.position}
                        </TextLink>
                      </TD>
                      <TD>{wr.shift_date}</TD>
                      <TD>
                        {wr.shift_start_time}–{wr.shift_end_time}
                      </TD>
                      <TD>
                        {wr.workers_confirmed}/{wr.workers_needed}
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

      <Pager
        page={page}
        hasNext={hasNext}
        onPageChange={setPage}
        disabled={isLoading}
      />
    </div>
  );
}
