"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { useHotel, useHotelGroups } from "@/hooks/useHotels";
import { ApiError, hotelsApi } from "@/lib/api";
import { HotelWriteGate } from "@/components/auth/RoleGate";
import { HotelForm } from "@/components/hotels/HotelForm";
import type { HotelFormValues } from "@/components/hotels/HotelForm";
import { Card, CardContent, PageHeader, Skeleton } from "@/components/ui";
import { BackLink } from "@/components/ui/BackLink";
import type { UpdateHotelInput } from "@/lib/types";
import { useTranslation } from "react-i18next";

function EditHotel() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const { data: hotel, isLoading, error } = useHotel(id);
  const { groups } = useHotelGroups({ limit: 100 });

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (values: HotelFormValues) => {
    setSubmitError(null);
    setSubmitting(true);
    const payload: UpdateHotelInput = {
      name: values.name,
      city: values.city,
      country: values.country.trim(),
      address: values.address,
      timezone: values.timezone,
      is_active: values.is_active,
      accepting_jobs: values.accepting_jobs,
      // Omitting the field leaves the assignment unchanged; an empty
      // selection only sends `null` (clear) when the hotel currently has an
      // assignment to clear, so re-visiting this form without touching the
      // selector never accidentally unassigns anything.
      ...(values.hotel_group_id
        ? { hotel_group_id: values.hotel_group_id }
        : hotel?.hotel_group_id
          ? { hotel_group_id: null }
          : {}),
      // GD-14/OD-GEO-001/004: only send coordinates when both fields are
      // filled in — same "omitted = leave unchanged" convention as
      // hotel_group_id above. Sending only one of the two would leave the
      // hotel in a state backend-geo's fail-closed check treats as
      // "unconfigured" anyway (both are required for a valid distance-check).
      ...(values.latitude.trim() && values.longitude.trim()
        ? { latitude: Number(values.latitude), longitude: Number(values.longitude) }
        : hotel?.latitude != null || hotel?.longitude != null
          ? { latitude: null, longitude: null }
          : {}),
    };
    try {
      const updated = await hotelsApi.update(id, payload);
      await Promise.all([
        globalMutate(["hotel", id], updated, false),
        globalMutate((key) => Array.isArray(key) && key[0] === "hotels"),
      ]);
      router.replace(`/hotels/${id}`);
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
        <BackLink href={`/hotels/${id}`} className="text-sm" labelKey="common.backTo.hotel" />
        <PageHeader className="mt-2" title={t("hotels.editTitle")} />
      </div>

      {error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-red-600 dark:text-red-400">
            {t("hotels.loadOneFailed")}
          </CardContent>
        </Card>
      ) : isLoading || !hotel ? (
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </CardContent>
        </Card>
      ) : (
        <HotelForm
          mode="edit"
          hotel={hotel}
          groups={groups}
          submitting={submitting}
          error={submitError}
          onSubmit={onSubmit}
          onCancel={() => router.push(`/hotels/${id}`)}
        />
      )}
    </div>
  );
}

export default function EditHotelPage() {
  const { t } = useTranslation();
  return (
    <HotelWriteGate
      fallback={
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="text-sm text-gray-500 dark:text-gray-400">
              {t("hotels.adminOnlyEdit")}
            </CardContent>
          </Card>
        </div>
      }
    >
      <EditHotel />
    </HotelWriteGate>
  );
}
