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
    const payload: CreateUserInput = {
      email: values.email,
      password: values.password,
      first_name: values.first_name,
      last_name: values.last_name,
      role: values.role,
      ...(values.phone ? { phone: values.phone } : {}),
      // ADR-065 (Universal Onboarding Gate): required for every non-admin
      // role — UserForm's own validation (`valid`) already blocks submit
      // without these, so `values.role === "admin"` is the only case they're
      // legitimately blank.
      ...(values.job_title ? { job_title: values.job_title } : {}),
      ...(values.start_date ? { start_date: values.start_date } : {}),
      ...(values.employment_type ? { employment_type: values.employment_type } : {}),
      // Always sent (not conditionally): `false` is a real, meaningful value
      // here, and omitting it is exactly how the requirement got silently
      // disabled for everyone.
      ...(values.role !== "admin" ? { work_permit_required: values.work_permit_required } : {}),
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
      ...(values.role === "manager" && values.hotel_id ? { hotel_id: values.hotel_id } : {}),
      ...(values.role === "regional_manager" && values.hotel_group_id
        ? { hotel_group_id: values.hotel_group_id }
        : {}),
    };
    try {
      const created = await usersApi.create(payload, photo);

      await mutate((key) => Array.isArray(key) && key[0] === "users");
      router.replace(`/users/${created.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
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
