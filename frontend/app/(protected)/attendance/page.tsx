"use client";

import { useState } from "react";
import { useAttendance } from "@/hooks/useAttendance";
import { AttendanceStatusBadge } from "@/components/attendance/AttendanceStatusBadge";
import { VerificationBadge } from "@/components/attendance/VerificationBadge";
import { formatDateTime } from "@/lib/format";
import {
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
import type { AttendanceStatus } from "@/lib/types";

const STATUS_FILTERS = [
  { value: "", label: "All statuses" },
  { value: "EXPECTED", label: "Expected" },
  { value: "PRESENT", label: "Present" },
  { value: "LATE", label: "Late" },
  { value: "PARTIAL", label: "Partial" },
  { value: "ABSENT", label: "Absent" },
  { value: "EXCUSED", label: "Excused" },
];

const VERIFIED_FILTERS = [
  { value: "", label: "Any" },
  { value: "true", label: "Verified" },
  { value: "false", label: "Unverified" },
];

const PER_PAGE = 20;
const COLUMNS = 5;

export default function AttendancePage() {
  const [status, setStatus] = useState<AttendanceStatus | "">("");
  const [verified, setVerified] = useState<"" | "true" | "false">("");
  const [page, setPage] = useState(1);

  const { records, isLoading, error, hasNext } = useAttendance({
    status: status || undefined,
    is_verified: verified === "" ? undefined : verified === "true",
    page,
    per_page: PER_PAGE,
  });

  const onStatusChange = (next: AttendanceStatus | "") => {
    setStatus(next);
    setPage(1);
  };

  const onVerifiedChange = (next: "" | "true" | "false") => {
    setVerified(next);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Check-in, check-out and verification status for staffed shifts."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full sm:w-48">
          <Select
            label="Status"
            value={status}
            onChange={(e) => onStatusChange(e.target.value as AttendanceStatus | "")}
            options={STATUS_FILTERS}
          />
        </div>
        <div className="w-full sm:w-48">
          <Select
            label="Verification"
            value={verified}
            onChange={(e) =>
              onVerifiedChange(e.target.value as "" | "true" | "false")
            }
            options={VERIFIED_FILTERS}
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="px-6 py-10 text-center text-sm text-red-600">
              Failed to load attendance. Please try again.
            </div>
          ) : (
            <Table aria-label="Attendance records">
              <THead>
                <tr>
                  <TH>Worker</TH>
                  <TH>Status</TH>
                  <TH>Check-in</TH>
                  <TH>Check-out</TH>
                  <TH>Verification</TH>
                </tr>
              </THead>
              {isLoading ? (
                <TableSkeleton columns={COLUMNS} />
              ) : records.length === 0 ? (
                <TBody>
                  <tr>
                    <TD colSpan={COLUMNS} className="p-0">
                      <EmptyState
                        title="No attendance records found"
                        description={
                          status || verified
                            ? "Try adjusting your filters."
                            : "Records appear once workers check in to their shifts."
                        }
                      />
                    </TD>
                  </tr>
                </TBody>
              ) : (
                <TBody>
                  {records.map((r) => (
                    <TR key={r.id}>
                      <TD className="font-medium">
                        <TextLink
                          href={`/attendance/${r.id}`}
                          className="block"
                        >
                          {r.worker_id}
                        </TextLink>
                      </TD>
                      <TD>
                        <AttendanceStatusBadge status={r.status} />
                      </TD>
                      <TD>{formatDateTime(r.check_in_at)}</TD>
                      <TD>{formatDateTime(r.check_out_at)}</TD>
                      <TD>
                        <VerificationBadge verified={r.is_verified} />
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
