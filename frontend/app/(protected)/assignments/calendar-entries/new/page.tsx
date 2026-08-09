"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useHotelOptions } from "@/hooks/useWorkRequests";
import { useUserOptions } from "@/hooks/useHotels";
import { assignmentsApi, ApiError } from "@/lib/api";
import { StaffingWriteGate } from "@/components/auth/RoleGate";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormError,
  Input,
  PageHeader,
  Select,
  TextLink,
} from "@/components/ui";
import type { CreateCalendarEntryInput } from "@/lib/types";

interface FormState {
  hotel_id: string;
  worker_id: string;
  day: string;
}

const INITIAL: FormState = {
  hotel_id: "",
  worker_id: "",
  day: "",
};

function NewCalendarEntryForm() {
  const router = useRouter();
  const { hotels, isLoading: hotelsLoading } = useHotelOptions();
  const { users: workers, isLoading: workersLoading } = useUserOptions({ role: "worker" });

  const [form, setForm] = useState<FormState>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const valid = form.hotel_id && form.worker_id && form.day;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setError(null);
    setSubmitting(true);

    const input: CreateCalendarEntryInput = {
      hotel_id: form.hotel_id,
      worker_id: form.worker_id,
      day: form.day,
    };

    try {
      await assignmentsApi.createCalendarEntry(input);
      router.replace("/assignments");
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
        <TextLink href="/assignments" className="text-sm">
          ← Back to assignments
        </TextLink>
        <PageHeader
          className="mt-2"
          title="Place worker on calendar"
          description="Directly confirm a worker for a hotel and day — no broadcast, no accept step."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Placement details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <Select
              label="Hotel"
              required
              value={form.hotel_id}
              onChange={(e) => set("hotel_id", e.target.value)}
              placeholder={hotelsLoading ? "Loading hotels…" : "Select a hotel"}
            >
              {hotels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} — {h.city}, {h.country}
                </option>
              ))}
            </Select>

            <Select
              label="Worker"
              required
              value={form.worker_id}
              onChange={(e) => set("worker_id", e.target.value)}
              placeholder={workersLoading ? "Loading workers…" : "Select a worker"}
            >
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.first_name} {w.last_name} — {w.email}
                </option>
              ))}
            </Select>

            <Input
              label="Day"
              type="date"
              required
              value={form.day}
              onChange={(e) => set("day", e.target.value)}
            />

            <FormError>{error}</FormError>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="submit" loading={submitting} disabled={submitting || !valid}>
                Place worker
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function NewCalendarEntryPage() {
  return (
    <StaffingWriteGate
      fallback={
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="text-sm text-gray-500 dark:text-gray-400">
              Only managers and admins can place a worker on the calendar.
            </CardContent>
          </Card>
        </div>
      }
    >
      <NewCalendarEntryForm />
    </StaffingWriteGate>
  );
}
