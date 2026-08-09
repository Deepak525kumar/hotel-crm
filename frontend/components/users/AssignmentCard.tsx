"use client";

import { useState } from "react";
import { mutate as globalMutate } from "swr";
import { useHotels, useHotelGroups } from "@/hooks/useHotels";
import { useEmploymentRecord } from "@/hooks/useEmployment";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { usersApi } from "@/lib/api";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataList,
  DataRow,
  FormError,
  Modal,
  Select,
  TextLink,
} from "@/components/ui";
import type { Role, UserDetail } from "@/lib/types";

/**
 * Person-centric assignment (2026-08-07).
 *
 * Organizational assignment originates HERE, from the person — not from the
 * hotel/group edit forms, which are now display-only for these relationships.
 * Everything routes through `PUT /users/:id/role`, the single authoritative
 * write path for role AND assignment, so a role change can never leave a
 * stale `Hotel.manager_user_id` / `HotelGroup.regional_manager_user_id`
 * pointing at someone who no longer holds the post. The backend vacates any
 * incompatible prior assignment inside the same transaction.
 *
 * Role determines what may be assigned:
 *   manager           -> exactly one hotel
 *   regional_manager  -> exactly one hotel group
 *   worker | checker  -> an employment group (eligibility) plus an optional
 *                        primary/home hotel (display only — does NOT restrict
 *                        scheduling; see REQ-EMP-012)
 */
export function AssignmentCard({ user }: { user: UserDetail }) {
  const isManager = user.role === "manager";
  const isRegionalManager = user.role === "regional_manager";
  const isStaff = user.role === "worker" || user.role === "checker";
  const assignable = isManager || isRegionalManager || isStaff;

  const { hotels } = useHotels({ limit: 100 });
  const { groups: hotelGroups } = useHotelGroups({ limit: 100 });
  const { data: employment } = useEmploymentRecord(isStaff ? user.id : null);

  const [open, setOpen] = useState(false);
  const [hotelId, setHotelId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [primaryHotelId, setPrimaryHotelId] = useState("");
  const action = useAsyncAction();

  if (!assignable) return null;

  // A manager's/RM's current posting is derived from the hotel/group that
  // points at them — the same columns `resolveScope()` reads to mint their
  // JWT scope claim, so what's displayed here is exactly what governs their
  // access, never a second copy that could disagree.
  const managedHotel = hotels.find((h) => h.manager_user_id === user.id);
  const managedGroup = hotelGroups.find((g) => g.regional_manager_user_id === user.id);
  const employmentGroup = hotelGroups.find((g) => g.id === employment?.hotel_group_id);
  const primaryHotel = hotels.find((h) => h.id === employment?.primary_hotel_id);

  const openModal = () => {
    setHotelId(managedHotel?.id ?? "");
    setGroupId(managedGroup?.id ?? employment?.hotel_group_id ?? "");
    setPrimaryHotelId(employment?.primary_hotel_id ?? "");
    setOpen(true);
  };

  const save = () =>
    action.run(
      () =>
        usersApi.updateRole(user.id, {
          role: user.role as Role,
          ...(isManager && hotelId ? { hotel_id: hotelId } : {}),
          ...((isRegionalManager || isStaff) && groupId ? { hotel_group_id: groupId } : {}),
          ...(isStaff ? { primary_hotel_id: primaryHotelId || null } : {}),
        }),
      {
        onSuccess: async () => {
          // The write fans out beyond the user row: a hotel/group's manager
          // pointer changed, and a worker's employment record may have too.
          await Promise.all([
            globalMutate(["user", user.id]),
            globalMutate(["employment-record", user.id]),
            globalMutate((key) => Array.isArray(key) && key[0] === "hotels"),
            globalMutate((key) => Array.isArray(key) && key[0] === "hotel-groups"),
            globalMutate((key) => Array.isArray(key) && key[0] === "hotel"),
            globalMutate((key) => Array.isArray(key) && key[0] === "hotel-group"),
          ]);
          setOpen(false);
        },
        errorMessage: "Failed to save the assignment. Please try again.",
      },
    );

  const unassigned = <span className="text-gray-500 dark:text-gray-400">Unassigned</span>;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Assignment</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <DataList>
            {isManager && (
              <DataRow
                label="Manages hotel"
                value={
                  managedHotel ? (
                    <TextLink href={`/hotels/${managedHotel.id}`}>{managedHotel.name}</TextLink>
                  ) : (
                    unassigned
                  )
                }
              />
            )}
            {isRegionalManager && (
              <DataRow
                label="Manages group"
                value={
                  managedGroup ? (
                    <TextLink href={`/hotel-groups/${managedGroup.id}`}>{managedGroup.name}</TextLink>
                  ) : (
                    unassigned
                  )
                }
              />
            )}
            {isStaff && (
              <>
                <DataRow
                  label="Hotel group"
                  value={
                    employmentGroup ? (
                      <TextLink href={`/hotel-groups/${employmentGroup.id}`}>
                        {employmentGroup.name}
                      </TextLink>
                    ) : (
                      unassigned
                    )
                  }
                />
                <DataRow
                  label="Primary hotel"
                  value={
                    primaryHotel ? (
                      <TextLink href={`/hotels/${primaryHotel.id}`}>{primaryHotel.name}</TextLink>
                    ) : (
                      <span className="text-gray-500 dark:text-gray-400">Not set</span>
                    )
                  }
                />
              </>
            )}
          </DataList>

          <div className="flex justify-end pt-3">
            <Button variant="outline" onClick={openModal}>
              Edit assignment
            </Button>
          </div>
        </CardContent>
      </Card>

      <Modal
        open={open}
        onClose={() => !action.pending && setOpen(false)}
        title="Edit assignment"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={action.pending}>
              Cancel
            </Button>
            <Button onClick={save} loading={action.pending}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {isManager && (
            <Select
              label="Hotel"
              hint="Assigning a hotel that already has a different manager is rejected."
              value={hotelId}
              onChange={(e) => setHotelId(e.target.value)}
            >
              <option value="">Leave unassigned</option>
              {hotels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                  {h.manager_user_id && h.manager_user_id !== user.id ? " — already managed" : ""}
                </option>
              ))}
            </Select>
          )}

          {isRegionalManager && (
            <Select
              label="Hotel group"
              hint="Assigning a group that already has a different regional manager is rejected."
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">Leave unassigned</option>
              {hotelGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.regional_manager_user_id && g.regional_manager_user_id !== user.id
                    ? " — already managed"
                    : ""}
                </option>
              ))}
            </Select>
          )}

          {isStaff && (
            <>
              <Select
                label="Hotel group"
                hint="Where this person is allowed to work."
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              >
                <option value="">Leave unassigned</option>
                {hotelGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>

              <Select
                label="Primary hotel (optional)"
                hint="Where they normally work. Does not limit which hotels they can be scheduled at."
                value={primaryHotelId}
                onChange={(e) => setPrimaryHotelId(e.target.value)}
              >
                <option value="">Not set</option>
                {hotels
                  .filter((h) => !groupId || h.hotel_group_id === groupId)
                  .map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
              </Select>
            </>
          )}

          <FormError>{action.error}</FormError>
        </div>
      </Modal>
    </>
  );
}
