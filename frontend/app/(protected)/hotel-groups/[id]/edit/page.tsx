"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { mutate as globalMutate } from "swr";
import { useHotelGroup, useUserOptions } from "@/hooks/useHotels";
import { ApiError, hotelGroupsApi } from "@/lib/api";
import { RoleGate } from "@/components/auth/RoleGate";
import { HotelGroupForm } from "@/components/hotels/HotelGroupForm";
import type { HotelGroupFormValues } from "@/components/hotels/HotelGroupForm";
import { Card, CardContent, PageHeader, Skeleton } from "@/components/ui";
import type { UpdateHotelGroupInput } from "@/lib/types";

function EditHotelGroup() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const { data: group, isLoading, error } = useHotelGroup(id);
  const { users: managers, isLoading: managersLoading } = useUserOptions({
    role: "manager",
  });

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (values: HotelGroupFormValues) => {
    setSubmitError(null);
    setSubmitting(true);
    const payload: UpdateHotelGroupInput = {
      name: values.name,
      regional_manager_user_id: values.regional_manager_user_id,
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
        <Link
          href={`/hotel-groups/${id}`}
          className="text-sm text-blue-700 hover:underline"
        >
          ← Back to hotel group
        </Link>
        <PageHeader className="mt-2" title="Edit hotel group" />
      </div>

      {error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-red-600">
            Failed to load this hotel group.
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
          managers={managers}
          managersLoading={managersLoading}
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
  return (
    <RoleGate
      allow={["admin"]}
      fallback={
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="text-sm text-gray-500">
              Only admins can edit hotel groups.
            </CardContent>
          </Card>
        </div>
      }
    >
      <EditHotelGroup />
    </RoleGate>
  );
}
