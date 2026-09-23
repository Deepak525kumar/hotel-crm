"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useMyInspections } from "@/hooks/useMyInspections";
import { useAuth } from "@/hooks/useAuth";
import { RoleGate } from "@/components/auth/RoleGate";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { formatDateTime } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  PageHeader,
  Table,
  TableSkeleton,
  TBody,
  TD,
  TH,
  THead,
} from "@/components/ui";
import { Camera } from "lucide-react";

/**
 * The checks this checker recorded — the web half of the mobile History tab.
 *
 * Until 2026-09-22 the web had no route to `/quality/my-inspections` at all: a
 * checker could record an inspection from the assignment page and then never
 * see it again. Everything else in that flow already existed on the web (the
 * room picker, the score, the photos, assigning rework); only the way back to
 * a past check was missing.
 *
 * Each row links to the assignment it was recorded against, because that page
 * is where the evidence and "Assign rework" already live. Rebuilding either
 * here would have been a second implementation of a screen that works.
 */
function InspectionHistory() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  // Debounced so typing a worker's name is one request when they stop, not one
  // per keystroke — every one of these is a database query behind a join.
  const q = useDebouncedValue(search, 300);

  // WHICH history this is depends on the viewer, not on the page.
  //
  // A checker's own checks are the point of /my-inspections. A manager, RM or
  // admin has recorded none, so that endpoint returned an empty list forever
  // and the tab looked broken rather than inapplicable (reported 2026-09-23).
  // They read `/quality/checks` instead, scoped server-side to their hotels.
  //
  // All THREE management strings: `role !== "checker"` would have done here,
  // but this codebase's most repeated bug is a role list that omits
  // regional_manager, and an allow-list is the shape that fails safe.
  const scoped =
    user?.role === "admin" || user?.role === "manager" || user?.role === "regional_manager";

  const { checks, pagination, isLoading, error } = useMyInspections(page, 20, q, scoped);

  const columns = 6;
  const totalPages = pagination?.total_pages ?? 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("nav.history")}
        description={t("quality.historySubtitle")}
        actions={
          <div className="w-full sm:w-72">
            <Input
              aria-label={t("quality.searchPlaceholder")}
              placeholder={t("quality.searchPlaceholder")}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                // A new search restarts paging: staying on page 4 of the old
                // result set shows an empty table and reads as "no matches".
                setPage(1);
              }}
            />
          </div>
        }
      />

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="px-6 py-10 text-center text-sm text-red-600 dark:text-red-400">
              {t("errors.requestFailed")}
            </div>
          ) : (
            <Table aria-label={t("nav.history")}>
              <THead>
                <tr>
                  <TH>{t("fields.date")}</TH>
                  <TH>{t("fields.worker")}</TH>
                  <TH>{t("quality.roomLabel")}</TH>
                  <TH>{t("fields.hotel")}</TH>
                  <TH>{t("fields.score0to100")}</TH>
                  <TH className="text-end">{t("common.actions")}</TH>
                </tr>
              </THead>
              {isLoading ? (
                <TableSkeleton columns={columns} />
              ) : checks.length === 0 ? (
                <TBody>
                  <tr>
                    <TD colSpan={columns} className="p-0">
                      <EmptyState
                        title={
                          q
                            ? t("quality.searchNoResults")
                            : t("quality.historyEmpty")
                        }
                        description={
                          q ? t("quality.searchNoResultsBody") : t("quality.historyEmptyBody")
                        }
                      />
                    </TD>
                  </tr>
                </TBody>
              ) : (
                <TBody>
                  {checks.map((check) => (
                    <tr key={check.id}>
                      <TD>{formatDateTime(check.created_at)}</TD>
                      <TD>
                        {check.worker
                          ? `${check.worker.first_name} ${check.worker.last_name}`
                          : t("quality.workerUnavailable")}
                      </TD>
                      <TD>
                        <span className="flex items-center gap-2">
                          {check.room_number}
                          {/* Shown as a count, not as thumbnails: the list
                              endpoint returns photo_count precisely so a page
                              of twenty rows is one request instead of sixty. */}
                          {check.photo_count > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                              <Camera className="h-3 w-3" aria-hidden />
                              {check.photo_count}
                            </span>
                          )}
                        </span>
                      </TD>
                      <TD>{check.hotel?.name ?? "—"}</TD>
                      <TD>
                        <span className="flex items-center gap-2">
                          {check.score}
                          {/* rework_required is the checker's own decision and
                              is NOT derived from the score — rework is
                              assignable at any score (quality/service.ts), so
                              inferring it from a threshold here would
                              contradict the record. */}
                          {check.rework_required && (
                            <Badge tone="warning">
                              {check.rework_completed_at
                                ? t("quality.reworkCompleted")
                                : t("quality.reworkPending")}
                            </Badge>
                          )}
                        </span>
                      </TD>
                      <TD className="text-end">
                        <Link href={`/assignments/${check.assignment_id}`}>
                          <Button variant="secondary" size="sm">
                            {t("common.details")}
                          </Button>
                        </Link>
                      </TD>
                    </tr>
                  ))}
                </TBody>
              )}
            </Table>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {`${page} / ${totalPages}`}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t("common.previous")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("common.next")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function InspectionsPage() {
  // `admin` alongside `checker` for the same reason every other quality surface
  // admits it: an admin is unscoped and supports checkers in the field. It is
  // still SELF-scoped server-side — an admin sees the checks they recorded, not
  // everyone's.
  return (
    <RoleGate allow={["checker", "admin", "manager", "regional_manager"]}>
      <InspectionHistory />
    </RoleGate>
  );
}
