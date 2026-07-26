"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { useHotel, useHotelGroups } from "@/hooks/useHotels";
import { ApiError, hotelsApi } from "@/lib/api";
import { HotelWriteGate } from "@/components/auth/RoleGate";
import { HotelForm } from "@/components/hotels/HotelForm";
import type { HotelFormValues } from "@/components/hotels/HotelForm";
import { Card, CardContent, PageHeader, Skeleton, TextLink } from "@/components/ui";
import type { UpdateHotelInput } from "@/lib/types";

function EditHotel() {
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
      // Only send a group assignment when one is selected; the API treats an
      // omitted field as "leave unchanged".
      ...(values.hotel_group_id
        ? { hotel_group_id: values.hotel_group_id }
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
        <TextLink
          href={`/hotels/${id}`}
          className="text-sm"
        >
          ← Back to hotel
        </TextLink>
        <PageHeader className="mt-2" title="Edit hotel" />
      </div>

      {error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-red-600">
            Failed to load this hotel.
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
  return (
    <HotelWriteGate
      fallback={
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="text-sm text-gray-500">
              Only admins can edit hotels.
            </CardContent>
          </Card>
        </div>
      }
    >
      <EditHotel />
    </HotelWriteGate>
  );
}
