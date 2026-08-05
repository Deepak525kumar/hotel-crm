"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useHotelOptions } from "@/hooks/useWorkRequests";
import { workRequestsApi } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { JobDispatchPhase2WriteGate } from "@/components/auth/RoleGate";
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
import type { RaiseBroadcastInput, SkillTag } from "@/lib/types";

const SKILL_OPTIONS: { value: SkillTag; label: string }[] = [
  { value: "CLEANER", label: "Cleaner" },
  { value: "PUBLIC_SERVICE", label: "Public service" },
  { value: "KITCHEN_DISHWASHER", label: "Kitchen dishwasher" },
  { value: "WAITER", label: "Waiter" },
];

interface SkillLine {
  skill: SkillTag;
  headcount: string;
}

interface FormState {
  hotel_id: string;
  shift_date: string;
  shift_start_time: string;
  shift_end_time: string;
  hourly_rate: string;
  currency: string;
  description: string;
  skills: SkillLine[];
}

const INITIAL: FormState = {
  hotel_id: "",
  shift_date: "",
  shift_start_time: "",
  shift_end_time: "",
  hourly_rate: "",
  currency: "EUR",
  description: "",
  skills: [{ skill: "CLEANER", headcount: "1" }],
};

function NewBroadcastForm() {
  const router = useRouter();
  const { hotels, isLoading: hotelsLoading } = useHotelOptions();

  const [form, setForm] = useState<FormState>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const setSkillLine = (index: number, patch: Partial<SkillLine>) =>
    setForm((prev) => ({
      ...prev,
      skills: prev.skills.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));

  const addSkillLine = () =>
    setForm((prev) => ({
      ...prev,
      skills: [...prev.skills, { skill: "CLEANER", headcount: "1" }],
    }));

  const removeSkillLine = (index: number) =>
    setForm((prev) => ({
      ...prev,
      skills: prev.skills.filter((_, i) => i !== index),
    }));

  // Best-effort guards only, using the browser's local date/time -- the
  // backend has no equivalent cross-field check today (format-only regex),
  // so these are purely a UX improvement for honest input, not a security
  // boundary. Same "min = today, browser-local" convention as
  // AbsencesCard's date guard.
  const today = new Date().toISOString().slice(0, 10);
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

  const valid =
    form.hotel_id &&
    form.shift_date &&
    form.shift_start_time &&
    form.shift_end_time &&
    form.skills.length > 0 &&
    form.skills.every((line) => Number(line.headcount) > 0) &&
    !dateTimeError;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setError(null);
    setSubmitting(true);

    const rate = form.hourly_rate.trim();
    const input: RaiseBroadcastInput = {
      hotel_id: form.hotel_id,
      shift_date: form.shift_date,
      shift_start_time: form.shift_start_time,
      shift_end_time: form.shift_end_time,
      hourly_rate: rate ? Number(rate) : undefined,
      currency: form.currency.trim() || undefined,
      description: form.description.trim() || undefined,
      skills: form.skills.map((line) => ({
        skill: line.skill,
        headcount: Number(line.headcount),
      })),
    };

    try {
      const created = await workRequestsApi.raiseBroadcast(input);
      router.replace(`/requests/broadcasts/${created.id}`);
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
        <TextLink href="/requests/broadcasts" className="text-sm">
          ← Back to broadcasts
        </TextLink>
        <PageHeader
          className="mt-2"
          title="New broadcast"
          description="Raise a shift to every eligible worker at once. Whoever accepts first for a skill claims that slot."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Shift details</CardTitle>
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

            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label="Shift date"
                type="date"
                required
                min={today}
                value={form.shift_date}
                onChange={(e) => set("shift_date", e.target.value)}
              />
              <Input
                label="Start time"
                type="time"
                required
                value={form.shift_start_time}
                onChange={(e) => set("shift_start_time", e.target.value)}
              />
              <Input
                label="End time"
                type="time"
                required
                min={form.shift_start_time || undefined}
                value={form.shift_end_time}
                onChange={(e) => set("shift_end_time", e.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Hourly rate (optional)"
                type="number"
                min={0}
                step="0.01"
                value={form.hourly_rate}
                onChange={(e) => set("hourly_rate", e.target.value)}
              />
              <Input
                label="Currency"
                maxLength={3}
                value={form.currency}
                onChange={(e) => set("currency", e.target.value.toUpperCase())}
                placeholder="EUR"
              />
            </div>

            <Textarea
              label="Description (optional)"
              rows={3}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">
                  Skills needed
                </span>
                <Button type="button" variant="outline" size="sm" onClick={addSkillLine}>
                  Add skill
                </Button>
              </div>

              {form.skills.map((line, index) => (
                <div key={index} className="flex items-end gap-3">
                  <div className="flex-1">
                    <Select
                      label={index === 0 ? "Skill" : undefined}
                      value={line.skill}
                      onChange={(e) =>
                        setSkillLine(index, { skill: e.target.value as SkillTag })
                      }
                      options={SKILL_OPTIONS}
                    />
                  </div>
                  <div className="w-28">
                    <Input
                      label={index === 0 ? "Headcount" : undefined}
                      type="number"
                      min={1}
                      required
                      value={line.headcount}
                      onChange={(e) => setSkillLine(index, { headcount: e.target.value })}
                    />
                  </div>
                  {form.skills.length > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removeSkillLine(index)}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <FormError>{dateTimeError ?? error}</FormError>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="submit" loading={submitting} disabled={submitting || !valid}>
                Raise broadcast
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function NewBroadcastPage() {
  return (
    <JobDispatchPhase2WriteGate
      fallback={
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="text-sm text-gray-500">
              Only managers and admins can raise a broadcast.
            </CardContent>
          </Card>
        </div>
      }
    >
      <NewBroadcastForm />
    </JobDispatchPhase2WriteGate>
  );
}
