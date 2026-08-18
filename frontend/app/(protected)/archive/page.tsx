"use client";

import { useState } from "react";
import { mutate as globalMutate } from "swr";
import { useHotels, useHotelGroups } from "@/hooks/useHotels";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { hotelGroupsApi, hotelsApi } from "@/lib/api";
import { RoleGate } from "@/components/auth/RoleGate";
import { formatDateTime } from "@/lib/format";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  FormError,
  PageHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";

/**
 * Archived (deleted) hotels and hotel groups, with restore.
 *
 * Deleted entities are excluded from every operational list, picker and
 * assignment flow — that is the point of the DELETED state. Without a
 * dedicated surface they would be unreachable, so this is the one place they
 * are visible, and it is admin-only.
 *
 * The backend enforces the same rule independently: `include_deleted` is
 * honoured only for an admin, so passing the flag as a manager widens nothing.
 * This gate is UX, not the security boundary.
 */
function ArchiveContent() {
  const { t } = useTranslation();
  // only_deleted: "true" returns exclusively deleted rows from the backend,
  // avoiding pagination cutoffs where a deleted hotel might fall on page 2
  // of a combined active+deleted list and get dropped.
  const { hotels, isLoading: hotelsLoading, error: hotelsError } = useHotels({
    only_deleted: "true",
    limit: 100,
  });
  const { groups, isLoading: groupsLoading, error: groupsError } = useHotelGroups({
    only_deleted: "true",
    limit: 100,
  });

  const deletedHotels = hotels;
  const deletedGroups = groups;

  const [restoringId, setRestoringId] = useState<string | null>(null);
  const action = useAsyncAction();

  const restore = (kind: "hotel" | "group", id: string) => {
    setRestoringId(id);
    return action.run(
      async () => {
        if (kind === "hotel") await hotelsApi.restore(id);
        else await hotelGroupsApi.restore(id);
        await Promise.all([
          globalMutate((key) => Array.isArray(key) && key[0] === "hotels"),
          globalMutate((key) => Array.isArray(key) && key[0] === "hotel-groups"),
        ]);
      },
      {
        onSuccess: () => setRestoringId(null),
        errorMessage: "Could not restore. Please try again.",
      },
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("nav.archive")}
        description={t("archive.description")}
      />

      <FormError>{action.error}</FormError>

      <Card>
        <CardHeader>
          <CardTitle>{t("hotels.deleted")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {hotelsError ? (
            <div className="px-6 py-10 text-center text-sm text-red-600 dark:text-red-400">
              {t("hotels.loadArchivedFailed")}
            </div>
          ) : hotelsLoading ? (
            <div className="px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400">{t("common.loading")}</div>
          ) : deletedHotels.length === 0 ? (
            <EmptyState
              title={t("hotels.noDeleted")}
              description={t("hotels.noDeletedDescription")}
            />
          ) : (
            <Table aria-label={t("hotels.deleted")}>
              <THead>
                <tr>
                  <TH>{t("fields.name")}</TH>
                  <TH>{t("fields.location")}</TH>
                  <TH>{t("status.deleted")}</TH>
                  <TH>{""}</TH>
                </tr>
              </THead>
              <TBody>
                {deletedHotels.map((h) => (
                  <TR key={h.id}>
                    <TD className="font-medium">{h.name}</TD>
                    <TD>
                      {h.city}, {h.country}
                    </TD>
                    <TD>{formatDateTime(h.deleted_at)}</TD>
                    <TD>
                      <Button
                        variant="outline"
                        onClick={() => restore("hotel", h.id)}
                        loading={action.pending && restoringId === h.id}
                      >
                        {t("hotels.restoreAction")}
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("hotels.deletedGroups")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {groupsError ? (
            <div className="px-6 py-10 text-center text-sm text-red-600 dark:text-red-400">
              {t("hotelGroups.loadArchivedFailed")}
            </div>
          ) : groupsLoading ? (
            <div className="px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400">{t("common.loading")}</div>
          ) : deletedGroups.length === 0 ? (
            <EmptyState
              title={t("hotelGroups.noDeleted")}
              description={t("hotelGroups.noDeletedDescription")}
            />
          ) : (
            <Table aria-label={t("hotels.deletedGroups")}>
              <THead>
                <tr>
                  <TH>{t("fields.name")}</TH>
                  <TH>{t("status.deleted")}</TH>
                  <TH>{""}</TH>
                </tr>
              </THead>
              <TBody>
                {deletedGroups.map((g) => (
                  <TR key={g.id}>
                    <TD className="font-medium">{g.name}</TD>
                    <TD>{formatDateTime(g.deleted_at)}</TD>
                    <TD>
                      <Button
                        variant="outline"
                        onClick={() => restore("group", g.id)}
                        loading={action.pending && restoringId === g.id}
                      >
                        {t("hotels.restoreAction")}
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ArchivePage() {
  const { t } = useTranslation();
  return (
    <RoleGate
      allow={["admin"]}
      fallback={
        <Card>
          <CardContent className="text-sm text-gray-500 dark:text-gray-400">
            {t("hotels.adminOnlyArchive")}
          </CardContent>
        </Card>
      }
    >
      <ArchiveContent />
    </RoleGate>
  );
}
