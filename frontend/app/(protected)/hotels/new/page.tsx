"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { ApiError, hotelsApi } from "@/lib/api";
import { HotelWriteGate } from "@/components/auth/RoleGate";
import { HotelForm } from "@/components/hotels/HotelForm";
import type { HotelFormValues } from "@/components/hotels/HotelForm";
import { useHotelGroups } from "@/hooks/useHotels";
import { Card, CardContent, PageHeader, TextLink } from "@/components/ui";
import type { CreateHotelInput } from "@/lib/types";
import { useTranslation } from "react-i18next";

function NewHotel() {
  const { t } = useTranslation();
  const router = useRouter();
  const { groups } = useHotelGroups({ limit: 100 });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (values: HotelFormValues) => {
    setError(null);
    setSubmitting(true);
    const payload: CreateHotelInput = {
      name: values.name,
      city: values.city,
      address: values.address,
      country: values.country.trim() || undefined,
      timezone: values.timezone || undefined,
      // GD-14/OD-GEO-001/004: only send coordinates when both fields are
      // filled in -- both are required for backend-geo's distance-check to
      // treat the hotel as configured anyway.
      ...(values.latitude.trim() && values.longitude.trim()
        ? { latitude: Number(values.latitude), longitude: Number(values.longitude) }
        : {}),
    };
    try {
      const created = await hotelsApi.create(payload);
      // Revalidate every hotel list query so the new row appears on return.
      await mutate((key) => Array.isArray(key) && key[0] === "hotels");

      // Group/manager assignment is update-only server-side (ADR-023/025:
      // "after a hotel is created, it is assigned") -- when either optional
      // field was filled in on the create form, immediately follow up with
      // a PATCH so the UX still reads as "set at creation time". The hotel
      // itself is already created and usable at this point, so a failure
      // here routes to its detail page (where the assignment can be retried
      // via Edit) instead of re-showing the create form.
      if (values.hotel_group_id) {
        try {
          await hotelsApi.update(created.id, {
            ...(values.hotel_group_id ? { hotel_group_id: values.hotel_group_id } : {}),
          });
        } catch {
          router.replace(`/hotels/${created.id}`);
          return;
        }
      }
      router.replace(`/hotels/${created.id}`);
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
        <TextLink href="/hotels" className="text-sm">
          ← Back to hotels
        </TextLink>
        <PageHeader
          className="mt-2"
          title={t("hotels.new")}
          description={t("hotels.newDescription")}
        />
      </div>
      <HotelForm
        mode="create"
        groups={groups}
        submitting={submitting}
        error={error}
        onSubmit={onSubmit}
        onCancel={() => router.push("/hotels")}
      />
    </div>
  );
}

export default function NewHotelPage() {
  return (
    <HotelWriteGate
      fallback={
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="text-sm text-gray-500 dark:text-gray-400">
              Only admins can create hotels.
            </CardContent>
          </Card>
        </div>
      }
    >
      <NewHotel />
    </HotelWriteGate>
  );
}
