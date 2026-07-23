"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { ApiError, hotelGroupsApi } from "@/lib/api";
import { useUserOptions } from "@/hooks/useHotels";
import { RoleGate } from "@/components/auth/RoleGate";
import { HotelGroupForm } from "@/components/hotels/HotelGroupForm";
import type { HotelGroupFormValues } from "@/components/hotels/HotelGroupForm";
import { Card, CardContent, PageHeader } from "@/components/ui";
import type { CreateHotelGroupInput } from "@/lib/types";

function NewHotelGroup() {
  const router = useRouter();
  const { users: managers, isLoading: managersLoading } = useUserOptions({
    role: "manager",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (values: HotelGroupFormValues) => {
    setError(null);
    setSubmitting(true);
    const payload: CreateHotelGroupInput = {
      name: values.name,
      regional_manager_user_id: values.regional_manager_user_id,
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
        <Link
          href="/hotel-groups"
          className="text-sm text-blue-700 hover:underline"
        >
          ← Back to hotel groups
        </Link>
        <PageHeader
          className="mt-2"
          title="New hotel group"
          description="Group hotels under one regional manager."
        />
      </div>
      <HotelGroupForm
        mode="create"
        managers={managers}
        managersLoading={managersLoading}
        submitting={submitting}
        error={error}
        onSubmit={onSubmit}
        onCancel={() => router.push("/hotel-groups")}
      />
    </div>
  );
}

export default function NewHotelGroupPage() {
  return (
    <RoleGate
      allow={["admin"]}
      fallback={
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="text-sm text-gray-500">
              Only admins can create hotel groups.
            </CardContent>
          </Card>
        </div>
      }
    >
      <NewHotelGroup />
    </RoleGate>
  );
}
