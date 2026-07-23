"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { ApiError, hotelsApi } from "@/lib/api";
import { RoleGate } from "@/components/auth/RoleGate";
import { HotelForm } from "@/components/hotels/HotelForm";
import type { HotelFormValues } from "@/components/hotels/HotelForm";
import { Card, CardContent, PageHeader } from "@/components/ui";
import type { CreateHotelInput } from "@/lib/types";

function NewHotel() {
  const router = useRouter();
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
    };
    try {
      const created = await hotelsApi.create(payload);
      // Revalidate every hotel list query so the new row appears on return.
      await mutate((key) => Array.isArray(key) && key[0] === "hotels");
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
        <Link href="/hotels" className="text-sm text-blue-700 hover:underline">
          ← Back to hotels
        </Link>
        <PageHeader
          className="mt-2"
          title="New hotel"
          description="Add a property. You can assign it to a group after creation."
        />
      </div>
      <HotelForm
        mode="create"
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
    <RoleGate
      allow={["manager", "admin"]}
      fallback={
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="text-sm text-gray-500">
              Only managers and admins can create hotels.
            </CardContent>
          </Card>
        </div>
      }
    >
      <NewHotel />
    </RoleGate>
  );
}
