"use client";

import { useState } from "react";
import { mutate as globalMutate } from "swr";
import { useHotels, useHotelGroups } from "@/hooks/useHotels";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { hotelGroupsApi, hotelsApi } from "@/lib/api";
import { RoleGate } from "@/components/auth/RoleGate";
import { formatDateTime } from "@/lib/format";
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
  // include_deleted returns BOTH live and deleted rows, so filter to the
  // deleted ones here — this page is the archive, not a superset listing.
  const { hotels, isLoading: hotelsLoading, error: hotelsError } = useHotels({
    include_deleted: "true",
    limit: 100,
  });
  const { groups, isLoading: groupsLoading, error: groupsError } = useHotelGroups({
    include_deleted: "true",
    limit: 100,
  });

  const deletedHotels = hotels.filter((h) => h.deleted_at);
  const deletedGroups = groups.filter((g) => g.deleted_at);

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
        title="Archive"
        description="Hotels and hotel groups removed from operations. History is preserved — restoring makes an entity available again immediately."
      />

      <FormError>{action.error}</FormError>

      <Card>
        <CardHeader>
          <CardTitle>Deleted hotels</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {hotelsError ? (
            <div className="px-6 py-10 text-center text-sm text-red-600">
              Failed to load archived hotels.
            </div>
          ) : hotelsLoading ? (
            <div className="px-6 py-10 text-center text-sm text-gray-500">Loading…</div>
          ) : deletedHotels.length === 0 ? (
            <EmptyState
              title="No deleted hotels"
              description="Deleted hotels appear here and can be restored."
            />
          ) : (
            <Table aria-label="Deleted hotels">
              <THead>
                <tr>
                  <TH>Name</TH>
                  <TH>Location</TH>
                  <TH>Deleted</TH>
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
                        Restore
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
          <CardTitle>Deleted hotel groups</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {groupsError ? (
            <div className="px-6 py-10 text-center text-sm text-red-600">
              Failed to load archived hotel groups.
            </div>
          ) : groupsLoading ? (
            <div className="px-6 py-10 text-center text-sm text-gray-500">Loading…</div>
          ) : deletedGroups.length === 0 ? (
            <EmptyState
              title="No deleted hotel groups"
              description="Deleted groups appear here and can be restored."
            />
          ) : (
            <Table aria-label="Deleted hotel groups">
              <THead>
                <tr>
                  <TH>Name</TH>
                  <TH>Deleted</TH>
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
                        Restore
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
  return (
    <RoleGate
      allow={["admin"]}
      fallback={
        <Card>
          <CardContent className="text-sm text-gray-500">
            Only admins can view the archive.
          </CardContent>
        </Card>
      }
    >
      <ArchiveContent />
    </RoleGate>
  );
}
