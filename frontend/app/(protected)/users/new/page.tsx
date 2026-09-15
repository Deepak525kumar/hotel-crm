"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { useHotels, useHotelGroups } from "@/hooks/useHotels";
import { ApiError, usersApi } from "@/lib/api";
import { RoleGate } from "@/components/auth/RoleGate";
import { UserForm } from "@/components/users/UserForm";
import type { UserFormSubmitValues } from "@/components/users/UserForm";
import { Card, CardContent, PageHeader } from "@/components/ui";
import { BackLink } from "@/components/ui/BackLink";
import type { CreateUserInput } from "@/lib/types";
import { useTranslation } from "react-i18next";

/**
 * The error, with WHICH FIELD failed.
 *
 * Reported 2026-09-15: an admin creating a worker saw only "Request body
 * validation failed" under a fully filled-in form. The server had said which
 * field -- `details: [{ field: "phone", message: "Invalid phone number" }]` --
 * and this page threw that away and showed the envelope's generic message, so
 * the admin had nine fields to suspect and no way to tell which one. (It was
 * the phone: a German number written with its leading 0, which the server now
 * accepts.)
 */
function describeApiError(err: ApiError): string {
  const details = Array.isArray(err.details) ? err.details : [];
  const lines = details
    .map((d) => {
      const item = d as { field?: unknown; message?: unknown };
      if (typeof item.message !== "string") return null;
      return typeof item.field === "string" && item.field
        ? `${item.field.replace(/_/g, " ")}: ${item.message}`
        : item.message;
    })
    .filter((line): line is string => Boolean(line));
  return lines.length > 0 ? lines.join(" · ") : err.message;
}

function NewUser() {
  const { t } = useTranslation();
  const router = useRouter();
  const { hotels } = useHotels({ limit: 100 });
  const { groups: hotelGroups } = useHotelGroups({ limit: 100 });
  
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (values: UserFormSubmitValues, photo: File | null) => {
    setError(null);
    // UserForm's own `valid` check already blocks submit without a photo in
    // create mode -- this is defence-in-depth, not the real gate, matching
    // the backend's own 400 when `photo` is missing from the multipart body.
    if (!photo) {
      setError("A profile photo is required.");
      return;
    }
    setSubmitting(true);
    // The group that owns the chosen hotel. `hotels` is already loaded for the
    // selector, so this needs no extra request.
    const derivedGroupId =
      hotels.find((h) => h.id === values.hotel_id)?.hotel_group_id ?? null;

    // The server refuses an admin-created manager with no target group, and
    // the group is derived from the hotel -- so a hotel that belongs to no
    // group cannot produce one. UserForm only offers grouped hotels for this
    // case; this catches the residue (a selection made before the hotel list
    // loaded, or a group removed from the hotel in another tab) and says so
    // here rather than surfacing a server error about `target_hotel_group_id`,
    // a field this form never shows.
    if (values.role === "manager" && !derivedGroupId) {
      setError(
        "Choose a hotel that belongs to a hotel group — a manager's group is taken from their hotel.",
      );
      setSubmitting(false);
      return;
    }
    const payload: CreateUserInput = {
      email: values.email,
      password: values.password,
      first_name: values.first_name,
      last_name: values.last_name,
      role: values.role,
      ...(values.phone ? { phone: values.phone } : {}),
      // Onboarding fields removed per request
      // Sent as part of creation so the choice is recorded atomically, as the
      // employment record's TARGET assignment.
      //
      // This deliberately does NOT go through PUT /users/:id/role after the
      // create. That call writes HotelGroup.regional_manager_user_id /
      // Hotel.manager_user_id directly, which is live operational scope, and it
      // does not consult the employment record at all — so calling it here made
      // every manager/RM created from this form the acting manager of a hotel or
      // group while their own application was still PENDING, straight past the
      // ADR-065 gate. It also split creation across two requests, so a rejected
      // second call (a group that already has an RM, say) left an account behind
      // with no assignment.
      // A hotel is meaningful for anyone who works AT one -- manager, worker
      // and checker -- not just a manager. Sent for all three so an
      // admin-created applicant lands in the right reviewer's queue:
      // isWorkerInReviewerScope falls back to these target fields while the
      // record is still PENDING, and with both null only an admin can see the
      // applicant at all.
      ...(values.role !== "regional_manager" && values.hotel_id
        ? { hotel_id: values.hotel_id }
        : {}),
      // The group. Chosen directly for a regional manager; for everyone else
      // it is DERIVED from the hotel they were given, because the backend
      // requires a target group when an admin creates a Manager
      // (createEmployee: "Admin must explicitly provide a
      // target_hotel_group_id") and an admin has no scope of their own to
      // infer it from. Deriving it means the admin picks one thing, the hotel,
      // and the group follows from it rather than being a second question
      // whose answer must agree.
      ...(values.role === "regional_manager"
        ? values.hotel_group_id
          ? { hotel_group_id: values.hotel_group_id }
          : {}
        : derivedGroupId
          ? { hotel_group_id: derivedGroupId }
          : {}),
      // Worker skills. Previously collected by the form and dropped on the
      // floor -- CreateUserSchema had no field for them, so Zod stripped the
      // key and every worker was saved with none.
      ...(values.role === "worker" && values.skills.length > 0
        ? { skills: values.skills }
        : {}),
    };
    try {
      const created = await usersApi.create(payload, photo);

      await mutate((key) => Array.isArray(key) && key[0] === "users");
      router.replace(`/users/${created.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? describeApiError(err)
          : "Something went wrong. Please try again.",
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <BackLink href="/users" className="text-sm" labelKey="common.backTo.users" />
        <PageHeader
          className="mt-2"
          title={t("users.new")}
          description={t("users.newDescription")}
        />
      </div>
      <UserForm
        mode="create"
        hotels={hotels}
        hotelGroups={hotelGroups}
        submitting={submitting}
        error={error}
        onSubmit={onSubmit}
        onCancel={() => router.push("/users")}
      />
    </div>
  );
}

export default function NewUserPage() {
  const { t } = useTranslation();
  return (
    // RULE A (project-owner decision, 2026-08-12): create is 1-level-down, so
    // manager and regional_manager may now create users too — each restricted
    // to its own one-level-down target role, which UserForm's selector enforces
    // (and users/service.ts enforces authoritatively). worker/checker may
    // create nobody and still get the fallback.
    <RoleGate
      allow={["admin", "regional_manager", "manager"]}
      fallback={
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="text-sm text-gray-500 dark:text-gray-400">
              {t("onboarding.noPermissionCreateUsers")}
            </CardContent>
          </Card>
        </div>
      }
    >
      <NewUser />
    </RoleGate>
  );
}
