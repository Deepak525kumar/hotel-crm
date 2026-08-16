"use client";

import { useState } from "react";
import { useAssignments } from "@/hooks/useAssignments";
import { useHotel, useUsersByIds } from "@/hooks/useHotels";
import { useWorkRequest } from "@/hooks/useWorkRequests";
import { AssignmentStatusBadge } from "@/components/assignments/AssignmentStatusBadge";
import { StaffingWriteGate } from "@/components/auth/RoleGate";
import { formatDate } from "@/lib/format";
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
import type { Assignment, AssignmentStatus } from "@/lib/types";
import { useTranslation } from "react-i18next";

const STATUS_FILTERS = [
  { value: "", label: "All statuses" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "NO_SHOW", label: "No show" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "REASSIGNED", label: "Reassigned" },
];

const PER_PAGE = 20;
const COLUMNS = 5;

function AssignmentRow({ assignment: a }: { assignment: Assignment }) {
  const { t } = useTranslation();
  const { data: hotel } = useHotel(a.hotel_id);
  const { data: workRequest } = useWorkRequest(a.job_request_id ?? a.work_request_id);
  const peopleById = useUsersByIds([a.worker_id]);
  const worker = peopleById.get(a.worker_id);

  return (
    <TR>
      <TD className="font-medium">
        <TextLink href={`/assignments/${a.id}`} className="block">
          {worker ? `${worker.first_name} ${worker.last_name}` : "View assignment"}
        </TextLink>
      </TD>
      <TD>
        <TextLink href={`/hotels/${a.hotel_id}`}>{hotel?.name ?? "View hotel"}</TextLink>
      </TD>
      <TD>
        {a.job_request_id ? (
          <TextLink href={`/requests/broadcasts/${a.job_request_id}`}>
            {workRequest?.position ?? "Broadcast"}
          </TextLink>
        ) : a.work_request_id ? (
          <TextLink href={`/requests/${a.work_request_id}`}>
            {workRequest?.position ?? "View request"}
          </TextLink>
        ) : (
          <span className="text-gray-500">{t("assignments.calendarPlacement")}</span>
        )}
        {workRequest && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {workRequest.shift_date} · {workRequest.shift_start_time}–{workRequest.shift_end_time}
          </div>
        )}
      </TD>
      <TD>{formatDate(a.confirmed_at)}</TD>
      <TD>
        <AssignmentStatusBadge status={a.status} />
      </TD>
    </TR>
  );
}

export default function AssignmentsPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<AssignmentStatus | "">("");
  const [page, setPage] = useState(1);

  const { assignments, isLoading, error, hasNext } = useAssignments({
    status: status || undefined,
    page,
    per_page: PER_PAGE,
  });

  const onStatusChange = (next: AssignmentStatus | "") => {
    setStatus(next);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("nav.assignments")}
        description="Confirmed workers and the shifts they are staffed on."
        actions={
          <StaffingWriteGate>
            <TextLink href="/assignments/calendar-entries" className="text-sm">
              Calendar placements →
            </TextLink>
          </StaffingWriteGate>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full sm:w-48">
          <Select
            label={t("fields.status")}
            value={status}
            onChange={(e) => onStatusChange(e.target.value as AssignmentStatus | "")}
            options={STATUS_FILTERS}
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="px-6 py-10 text-center text-sm text-red-600 dark:text-red-400">
              Failed to load assignments. Please try again.
            </div>
          ) : (
            <Table aria-label={t("nav.assignments")}>
              <THead>
                <tr>
                  <TH>{t("fields.worker")}</TH>
                  <TH>{t("fields.hotel")}</TH>
                  <TH>{t("requests.title")}</TH>
                  <TH>{t("status.confirmed")}</TH>
                  <TH>{t("fields.status")}</TH>
                </tr>
              </THead>
              {isLoading ? (
                <TableSkeleton columns={COLUMNS} />
              ) : assignments.length === 0 ? (
                <TBody>
                  <tr>
                    <TD colSpan={COLUMNS} className="p-0">
                      <EmptyState
                        title="No assignments found"
                        description={
                          status
                            ? "Try adjusting your filters."
                            : "Assignments appear once workers are placed on a shift."
                        }
                      />
                    </TD>
                  </tr>
                </TBody>
              ) : (
                <TBody>
                  {assignments.map((a) => (
                    <AssignmentRow key={a.id} assignment={a} />
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
