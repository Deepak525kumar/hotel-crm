"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { useHotelGroup } from "@/hooks/useHotels";
import { ApiError, hotelGroupsApi } from "@/lib/api";
import { RoleGate } from "@/components/auth/RoleGate";
import { HotelGroupForm } from "@/components/hotels/HotelGroupForm";
import type { HotelGroupFormValues } from "@/components/hotels/HotelGroupForm";
import { Card, CardContent, PageHeader, Skeleton } from "@/components/ui";
import { BackLink } from "@/components/ui/BackLink";
import type { UpdateHotelGroupInput } from "@/lib/types";
import { useTranslation } from "react-i18next";

function EditHotelGroup() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const { data: group, isLoading, error } = useHotelGroup(id);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (values: HotelGroupFormValues) => {
    setSubmitError(null);
    setSubmitting(true);
    const payload: UpdateHotelGroupInput = {
      name: values.name,
      billing_info: values.billing_info,
    };
    try {
      const updated = await hotelGroupsApi.update(id, payload);
      await Promise.all([
        globalMutate(["hotel-group", id], updated, false),
        globalMutate((key) => Array.isArray(key) && key[0] === "hotel-groups"),
      ]);
      router.replace(`/hotel-groups/${id}`);
    } catch (err) {
      setSubmitError(
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
        <BackLink href={`/hotel-groups/${id}`} className="text-sm" labelKey="common.backTo.hotelGroup" />
        <PageHeader className="mt-2" title={t("hotelGroups.editTitle")} />
      </div>

      {error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-red-600 dark:text-red-400">
            {t("hotelGroups.loadOneFailed")}
          </CardContent>
        </Card>
      ) : isLoading || !group ? (
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      ) : (
        <HotelGroupForm
          mode="edit"
          group={group}
          submitting={submitting}
          error={submitError}
          onSubmit={onSubmit}
          onCancel={() => router.push(`/hotel-groups/${id}`)}
        />
      )}
    </div>
  );
}

export default function EditHotelGroupPage() {
  const { t } = useTranslation();
  return (
    <RoleGate
      allow={["admin"]}
      fallback={
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="text-sm text-gray-500 dark:text-gray-400">
              {t("hotelGroups.adminOnlyEdit")}
            </CardContent>
          </Card>
        </div>
      }
    >
      <EditHotelGroup />
    </RoleGate>
  );
}
