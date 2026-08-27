"use client";

import { SKILL_OPTIONS } from "@/lib/skills";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useHotelOptions } from "@/hooks/useWorkRequests";
import { useHotel } from "@/hooks/useHotels";
import { localToday } from "@/lib/format";
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
} from "@/components/ui";
import { BackLink } from "@/components/ui/BackLink";
import type { RaiseBroadcastInput, SkillTag } from "@/lib/types";
import { useTranslation } from "react-i18next";

interface SkillLine {
  /** `null` means "no specific skill required" for this line. */
  skill: SkillTag | null;
  headcount: string;
}

/** Sentinel `<select>` value for the "no specific skill required" option — HTML select values must be strings, so `null` is represented as "" and converted back at submit time. */
const NO_SKILL_VALUE = "";

interface FormState {
  hotel_id: string;
  target_role: "WORKER" | "CHECKER";
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
  target_role: "WORKER",
  shift_date: "",
  shift_start_time: "",
  shift_end_time: "",
  hourly_rate: "",
  currency: "EUR",
  description: "",
  skills: [{ skill: "CLEANER", headcount: "1" }],
};

function NewBroadcastForm() {
  const { t } = useTranslation();
  const router = useRouter();
  const { hotels, isLoading: hotelsLoading } = useHotelOptions();

  const [form, setForm] = useState<FormState>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: selectedHotel } = useHotel(form.hotel_id);
  const today = selectedHotel
    ? new Date().toLocaleDateString("en-CA", { timeZone: selectedHotel.timezone })
    : localToday();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // CHECKER has no SkillTag values of its own (CLEANER/WAITER/... are
  // WORKER-domain) -- a checker-targeted broadcast is always a plain
  // headcount, using the "no specific skill required" (null) slot the
  // schema already supports rather than a fabricated CHECKER skill tag.
  // Switching target_role collapses/restores the skill-line editor so the
  // form can't submit a SkillTag alongside target_role: CHECKER.
  const setTargetRole = (role: "WORKER" | "CHECKER") =>
    setForm((prev) => ({
      ...prev,
      target_role: role,
      skills:
        role === "CHECKER"
          ? [{ skill: null, headcount: prev.skills[0]?.headcount ?? "1" }]
          : prev.skills.some((line) => line.skill !== null)
            ? prev.skills
            : [{ skill: "CLEANER", headcount: prev.skills[0]?.headcount ?? "1" }],
    }));

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

  // Best-effort guard only, using the browser's local date -- the backend
  // has no equivalent cross-field check today (format-only regex), so this
  // is purely a UX improvement for honest input, not a security boundary.
  // Unlike AbsencesCard's date guard, there is no backend fallback here if
  // this client check is ever wrong, so it must actually be correct: see
  // localToday()'s own comment for why a naive `toISOString()` slice is a
  // real bug (it's the UTC date, not the local one -- it incorrectly
  // treats "today" as already past for several hours every evening in any
  // timezone west of UTC).
  // is local today.
  const todayVal = today;
  const isPastDate = form.shift_date && form.shift_date < todayVal;
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
      target_role: form.target_role,
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
        <BackLink href="/requests/broadcasts" className="text-sm" labelKey="common.backTo.broadcasts" />
        <PageHeader
          className="mt-2"
          title={t("requests.newBroadcast")}
          description={t("requests.broadcastDescription")}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("assignments.shiftDetails")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
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

            <Select
              label={t("fields.targetRole")}
              required
              value={form.target_role}
              onChange={(e) => setTargetRole(e.target.value as "WORKER" | "CHECKER")}
            >
              <option value="WORKER">{t("fields.targetRoleWorker")}</option>
              <option value="CHECKER">{t("fields.targetRoleChecker")}</option>
            </Select>

            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label={t("assignments.shiftDate")}
                type="date"
                required
                min={today}
                value={form.shift_date}
                onChange={(e) => set("shift_date", e.target.value)}
              />
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
                onChange={(e) => set("currency", e.target.value.toUpperCase())}
                placeholder="EUR"
              />
            </div>

            <Textarea
              label={t("fields.descriptionOptional")}
              rows={3}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />

            {form.target_role === "CHECKER" ? (
              // No skill picker: a checker-targeted broadcast is a plain
              // headcount on the single null-skill slot (see setTargetRole).
              <div className="w-28">
                <Input
                  label={t("requests.checkersNeeded")}
                  type="number"
                  min={1}
                  required
                  value={form.skills[0]?.headcount ?? "1"}
                  onChange={(e) => setSkillLine(0, { headcount: e.target.value })}
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {t("requests.skillsNeeded")}
                  </span>
                  <Button type="button" variant="outline" size="sm" onClick={addSkillLine}>
                    {t("requests.addSkill")}
                  </Button>
                </div>

                {form.skills.map((line, index) => (
                  <div key={index} className="flex items-end gap-3">
                    <div className="flex-1">
                      <Select
                        label={index === 0 ? "Skill" : undefined}
                        value={line.skill ?? NO_SKILL_VALUE}
                        onChange={(e) =>
                          setSkillLine(index, {
                            skill: e.target.value === NO_SKILL_VALUE ? null : (e.target.value as SkillTag),
                          })
                        }
                        options={[
                          ...SKILL_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })),
                          { value: NO_SKILL_VALUE, label: t("requests.noSkillOption") },
                        ]}
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
                        {t("common.remove")}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <FormError>{dateTimeError ?? error}</FormError>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="submit" loading={submitting} disabled={submitting || !valid}>
                {t("requests.raiseBroadcastAction")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function NewBroadcastPage() {
  const { t } = useTranslation();
  return (
    <JobDispatchPhase2WriteGate
      fallback={
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardContent className="text-sm text-gray-500 dark:text-gray-400">
              {t("requests.adminOnlyRaiseBroadcast")}
            </CardContent>
          </Card>
        </div>
      }
    >
      <NewBroadcastForm />
    </JobDispatchPhase2WriteGate>
  );
}
