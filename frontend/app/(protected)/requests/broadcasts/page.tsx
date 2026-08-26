"use client";

import { useState } from "react";
import Link from "next/link";
import { useBroadcasts } from "@/hooks/useWorkRequests";
import { useHotel } from "@/hooks/useHotels";
import { skillSlotLabel } from "@/lib/skills";
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
import { useAuthStore } from "@/stores/auth";
import type { WorkRequest } from "@/lib/types";
import { useTranslation } from "react-i18next";

const PER_PAGE = 20;
const COLUMNS = 5;

function BroadcastRow({ broadcast: wr }: { broadcast: WorkRequest }) {
  const { t } = useTranslation();
  const { data: hotel } = useHotel(wr.hotel_id);

  return (
    <TR>
      <TD className="font-medium">
        <TextLink href={`/requests/broadcasts/${wr.id}`} className="block">
          {wr.shift_date}
        </TextLink>
      </TD>
      <TD>{hotel?.name ?? "—"}</TD>
      <TD>
        {wr.shift_start_time}–{wr.shift_end_time}
      </TD>
      <TD>
        {(wr.skill_slots ?? [])
          .map((s) => `${s.confirmed_count}/${s.headcount} ${skillSlotLabel(t, s.skill)}`)
          .join(", ")}
      </TD>
      <TD>
        <WorkRequestStatusBadge status={wr.status} />
      </TD>
    </TR>
  );
}

export default function BroadcastsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const role = useAuthStore((s) => s.user?.role);

  const { broadcasts, isLoading, error, hasNext } = useBroadcasts({
    page,
    per_page: PER_PAGE,
    ...(role === "worker" ? { status: ["OPEN", "PARTIALLY_FILLED"] } : {}),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("nav.broadcasts")}
        description={t("requests.broadcastsDescription")}
        actions={
          <JobDispatchPhase2WriteGate>
            <Link href="/requests/broadcasts/new">
              <Button>{t("requests.newBroadcast")}</Button>
            </Link>
          </JobDispatchPhase2WriteGate>
        }
      />

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="px-6 py-10 text-center text-sm text-red-600">
              {t("requests.broadcastsLoadFailed")}
            </div>
          ) : (
            <Table aria-label={t("nav.broadcasts")}>
              <THead>
                <tr>
                  <TH>{t("assignments.shiftDate")}</TH>
                  <TH>{t("fields.hotel")}</TH>
                  <TH>{t("fields.time")}</TH>
                  <TH>{t("fields.skills")}</TH>
                  <TH>{t("fields.status")}</TH>
                </tr>
              </THead>
              {isLoading ? (
                <TableSkeleton columns={COLUMNS} />
              ) : broadcasts.length === 0 ? (
                <TBody>
                  <tr>
                    <TD colSpan={COLUMNS} className="p-0">
                      <EmptyState
                        title={t("requests.noBroadcastsFound")}
                        description={t("requests.noBroadcastsDescription")}
                      />
                    </TD>
                  </tr>
                </TBody>
              ) : (
                <TBody>
                  {broadcasts.map((wr) => (
                    <BroadcastRow key={wr.id} broadcast={wr} />
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
