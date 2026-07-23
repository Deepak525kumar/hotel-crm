"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useWorkApplications } from "@/hooks/useWorkApplications";
import { ApplicationStatusBadge } from "@/components/work-applications/ApplicationStatusBadge";
import { formatDate, formatScore } from "@/lib/format";
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
import type { ApplicationStatus } from "@/lib/types";

const STATUS_FILTERS = [
  { value: "", label: "All statuses" },
  { value: "PENDING", label: "Pending" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "REJECTED", label: "Rejected" },
  { value: "WITHDRAWN", label: "Withdrawn" },
  { value: "EXPIRED", label: "Expired" },
];

const PER_PAGE = 20;
const COLUMNS = 4;

export default function WorkRequestApplicationsPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [status, setStatus] = useState<ApplicationStatus | "">("");
  const [page, setPage] = useState(1);

  const { applications, isLoading, error, hasNext } = useWorkApplications(id, {
    status: status || undefined,
    page,
    per_page: PER_PAGE,
  });

  const onStatusChange = (next: ApplicationStatus | "") => {
    setStatus(next);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div>
        <TextLink
          href={`/requests/${id}`}
          className="text-sm"
        >
          ← Back to work request
        </TextLink>
        <PageHeader
          className="mt-2"
          title="Applications"
          description="Workers who have applied to this shift."
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full sm:w-48">
          <Select
            label="Status"
            value={status}
            onChange={(e) => onStatusChange(e.target.value as ApplicationStatus | "")}
            options={STATUS_FILTERS}
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="px-6 py-10 text-center text-sm text-red-600">
              Failed to load applications. Please try again.
            </div>
          ) : (
            <Table aria-label="Applications">
              <THead>
                <tr>
                  <TH>Worker</TH>
                  <TH>Rating</TH>
                  <TH>Applied</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              {isLoading ? (
                <TableSkeleton columns={COLUMNS} />
              ) : applications.length === 0 ? (
                <TBody>
                  <tr>
                    <TD colSpan={COLUMNS} className="p-0">
                      <EmptyState
                        title="No applications found"
                        description={
                          status
                            ? "Try adjusting your filters."
                            : "Applications appear here once workers apply to this shift."
                        }
                      />
                    </TD>
                  </tr>
                </TBody>
              ) : (
                <TBody>
                  {applications.map((app) => (
                    <TR key={app.id}>
                      <TD className="font-medium">
                        <TextLink
                          href={`/requests/${id}/applications/${app.id}`}
                          className="block"
                        >
                          {app.worker_id}
                        </TextLink>
                      </TD>
                      <TD>{formatScore(app.worker_rating_snapshot)}</TD>
                      <TD>{formatDate(app.applied_at)}</TD>
                      <TD>
                        <ApplicationStatusBadge status={app.status} />
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
