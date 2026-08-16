"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { ApiError, hotelGroupsApi } from "@/lib/api";
import { RoleGate } from "@/components/auth/RoleGate";
import { HotelGroupForm } from "@/components/hotels/HotelGroupForm";
import type { HotelGroupFormValues } from "@/components/hotels/HotelGroupForm";
import { Card, CardContent, PageHeader } from "@/components/ui";
import { BackLink } from "@/components/ui/BackLink";
import type { CreateHotelGroupInput } from "@/lib/types";
import { useTranslation } from "react-i18next";

function NewHotelGroup() {
  const { t } = useTranslation();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (values: HotelGroupFormValues) => {
    setError(null);
    setSubmitting(true);
    const payload: CreateHotelGroupInput = {
      name: values.name,
      ...(values.billing_info ? { billing_info: values.billing_info } : {}),
    };
    try {
      const created = await hotelGroupsApi.create(payload);
      await mutate((key) => Array.isArray(key) && key[0] === "hotel-groups");
      router.replace(`/hotel-groups/${created.id}`);
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
        <BackLink href="/hotel-groups" className="text-sm" labelKey="common.backTo.hotelGroups" />
        <PageHeader
          className="mt-2"
          title={t("hotelGroups.newTitle")}
          description={t("hotelGroups.newDescription")}
        />
      </div>
      <HotelGroupForm
        mode="create"
        submitting={submitting}
        error={error}
        onSubmit={onSubmit}
        onCancel={() => router.push("/hotel-groups")}
      />
    </div>
  );
}

export default function NewHotelGroupPage() {
  const { t } = useTranslation();
  return (
    <RoleGate
      allow={["admin"]}
      fallback={
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="text-sm text-gray-500 dark:text-gray-400">
              {t("hotelGroups.adminOnlyCreate")}
            </CardContent>
          </Card>
        </div>
      }
    >
      <NewHotelGroup />
    </RoleGate>
  );
}
