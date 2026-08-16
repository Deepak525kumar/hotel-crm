"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useHotelOptions } from "@/hooks/useWorkRequests";
import { localToday } from "@/lib/format";
import { workRequestsApi } from "@/lib/api";
import { ApiError } from "@/lib/api";
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
  Textarea,
  TextLink,
} from "@/components/ui";
import type { CreateWorkRequestInput } from "@/lib/types";
import { useTranslation } from "react-i18next";

interface FormState {
  hotel_id: string;
  position: string;
  workers_needed: string;
  shift_date: string;
  shift_start_time: string;
  shift_end_time: string;
  hourly_rate: string;
  currency: string;
  description: string;
  requirements: string;
}

const INITIAL: FormState = {
  hotel_id: "",
  position: "",
  workers_needed: "1",
  shift_date: "",
  shift_start_time: "",
  shift_end_time: "",
  hourly_rate: "",
  currency: "EUR",
  description: "",
  requirements: "",
};

function NewWorkRequestForm() {
  const { t } = useTranslation();
  const router = useRouter();
  const { hotels, isLoading: hotelsLoading } = useHotelOptions();

  const [form, setForm] = useState<FormState>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"draft" | "publish" | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const buildPayload = (
    status: "DRAFT" | "OPEN",
  ): CreateWorkRequestInput => {
    const rate = form.hourly_rate.trim();
    return {
      hotel_id: form.hotel_id,
      position: form.position.trim(),
      workers_needed: Number(form.workers_needed),
      shift_date: form.shift_date,
      shift_start_time: form.shift_start_time,
      shift_end_time: form.shift_end_time,
      hourly_rate: rate ? Number(rate) : undefined,
      currency: form.currency.trim() || undefined,
      description: form.description.trim() || undefined,
      requirements: form.requirements.trim() || undefined,
      status,
    };
  };

  const submit = async (status: "DRAFT" | "OPEN") => {
    setError(null);
    setSubmitting(status === "OPEN" ? "publish" : "draft");
    try {
      const created = await workRequestsApi.create(buildPayload(status));
      router.replace(`/requests/${created.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again.",
      );
      setSubmitting(null);
    }
  };

  // Best-effort guard only, using the browser's local date -- the backend
  // has no equivalent cross-field check today (format-only regex), so this
  // is purely a UX improvement for honest input, not a security boundary.
  // Unlike AbsencesCard's date guard, there is no backend fallback here if
  // this client check is ever wrong, so it must actually be correct: see
  // localToday()'s own comment for why a naive `toISOString()` slice is a
  // real bug (it's the UTC date, not the local one -- it incorrectly
  // treats "today" as already past for several hours every evening in any
  // timezone west of UTC).
  const today = localToday();
  const isPastDate = form.shift_date && form.shift_date < today;
  const isEndBeforeStart =
    form.shift_start_time &&
    form.shift_end_time &&
    form.shift_end_time <= form.shift_start_time;
  const dateTimeError = isPastDate
    ? "Shift date cannot be in the past."
    : isEndBeforeStart
      ? "End time must be after start time."
      : null;

  // Native required attributes cover the mandatory fields; the publish button
  // additionally checks the form's validity before submitting as OPEN.
  const valid =
    form.hotel_id &&
    form.position.trim() &&
    form.shift_date &&
    form.shift_start_time &&
    form.shift_end_time &&
    Number(form.workers_needed) > 0 &&
    !dateTimeError;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    submit("DRAFT");
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <TextLink href="/requests" className="text-sm">
          ← Back to work requests
        </TextLink>
        <PageHeader
          className="mt-2"
          title={t("requests.newTitle")}
          description={t("requests.newDescription")}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("assignments.shiftDetails")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <Select
              label={t("fields.hotel")}
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

            <Input
              label={t("jobs.position")}
              required
              value={form.position}
              onChange={(e) => set("position", e.target.value)}
              placeholder="e.g. Housekeeper"
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={t("fields.workersNeeded")}
                type="number"
                min={1}
                required
                value={form.workers_needed}
                onChange={(e) => set("workers_needed", e.target.value)}
              />
              <Input
                label={t("assignments.shiftDate")}
                type="date"
                required
                min={today}
                value={form.shift_date}
                onChange={(e) => set("shift_date", e.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={t("fields.startTime")}
                type="time"
                required
                value={form.shift_start_time}
                onChange={(e) => set("shift_start_time", e.target.value)}
              />
              <Input
                label={t("fields.endTime")}
                type="time"
                required
                min={form.shift_start_time || undefined}
                value={form.shift_end_time}
                onChange={(e) => set("shift_end_time", e.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={t("fields.hourlyRateOptional")}
                type="number"
                min={0}
                step="0.01"
                value={form.hourly_rate}
                onChange={(e) => set("hourly_rate", e.target.value)}
              />
              <Input
                label={t("fields.currency")}
                maxLength={3}
                value={form.currency}
                onChange={(e) =>
                  set("currency", e.target.value.toUpperCase())
                }
                placeholder="EUR"
              />
            </div>

            <Textarea
              label={t("fields.descriptionOptional")}
              rows={3}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />

            <Textarea
              label={t("fields.requirementsOptional")}
              rows={3}
              value={form.requirements}
              onChange={(e) => set("requirements", e.target.value)}
            />

            <FormError>{dateTimeError ?? error}</FormError>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="submit"
                variant="outline"
                loading={submitting === "draft"}
                disabled={submitting !== null || !valid}
              >
                Save draft
              </Button>
              <Button
                type="button"
                loading={submitting === "publish"}
                disabled={submitting !== null || !valid}
                onClick={() => submit("OPEN")}
              >
                Publish
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function NewWorkRequestPage() {
  return (
    <StaffingWriteGate
      fallback={
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="text-sm text-gray-500 dark:text-gray-400">
              Only managers and admins can create work requests.
            </CardContent>
          </Card>
        </div>
      }
    >
      <NewWorkRequestForm />
    </StaffingWriteGate>
  );
}
