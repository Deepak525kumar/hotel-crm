"use client";

import { useState } from "react";
import { mutate } from "swr";
import { useOwnAbsences } from "@/hooks/useCalendar";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { calendarApi } from "@/lib/api";
import { formatDate, localToday } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  FormError,
  Input,
  Modal,
  Select,
  Skeleton,
  Textarea,
} from "@/components/ui";
import type { AbsenceKind, CalendarAbsence } from "@/lib/types";
import { useTranslation } from "react-i18next";

const KIND_LABEL: Record<AbsenceKind, string> = {
  SICK: "Sick",
  VACATION: "Vacation",
};

const KIND_TONE: Record<AbsenceKind, "warning" | "neutral"> = {
  SICK: "warning",
  VACATION: "neutral",
};

function AbsenceRow({ absence }: { absence: CalendarAbsence }) {
  // Withdrawing a declared absence (2026-08-13): the backend endpoint has
  // existed since the feature shipped, but no UI ever called it, so a worker
  // who marked a sick day by mistake or recovered early was stuck with it.
  // Only offered for today or later -- the backend rejects withdrawing a past
  // absence, and offering a button that always errors is worse than none.
  const withdraw = useAsyncAction();
  const isPast = absence.day < localToday();

  const onWithdraw = () =>
    withdraw.run(() => calendarApi.deleteAbsence(absence.id), {
      onSuccess: async () => {
        await mutate(["my-absences"]);
      },
    });

  return (
    <li className="border-b border-gray-100 py-3 last:border-b-0 dark:border-gray-800">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{formatDate(absence.day)}</p>
          {absence.reason && (
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">{absence.reason}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={KIND_TONE[absence.kind]}>{KIND_LABEL[absence.kind]}</Badge>
          {!isPast && (
            <Button size="sm" variant="outline" onClick={onWithdraw} loading={withdraw.pending}>
              Withdraw
            </Button>
          )}
        </div>
      </div>
      <FormError>{withdraw.error}</FormError>
    </li>
  );
}

/**
 * SPEC-CALENDAR-001 REQ-CAL-T02/T03/T08: a worker's own absences — list plus
 * self-service marking of a new sick/vacation day. Self-scoped end to end
 * (`/calendar/my-absences` takes no worker_id — the backend always resolves
 * the caller), so this needs no gate beyond being authenticated.
 */
export function AbsencesCard() {
  const { t } = useTranslation();
  const { data: absences, isLoading, error } = useOwnAbsences();
  const [markOpen, setMarkOpen] = useState(false);

  return (
    <>
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>{t("calendar.absences")}</CardTitle>
          <Button size="sm" onClick={() => setMarkOpen(true)}>
            Mark absence
          </Button>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="py-6 text-center text-sm text-red-600 dark:text-red-400">
              Failed to load your absences.
            </p>
          ) : isLoading ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          ) : !absences || absences.length === 0 ? (
            <EmptyState
              title={t("calendar.noAbsencesRecorded")}
              description={t("calendar.noAbsencesDescription")}
            />
          ) : (
            <ul>
              {absences.map((absence) => (
                <AbsenceRow key={absence.id} absence={absence} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <MarkAbsenceModal open={markOpen} onClose={() => setMarkOpen(false)} />
    </>
  );
}

function MarkAbsenceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [day, setDay] = useState("");
  const [kind, setKind] = useState<AbsenceKind>("SICK");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const mark = useAsyncAction();

  // Reason is mandatory for VACATION, optional for SICK (2026-08-08
  // feature). Deliberately not required for SICK: forcing detail on a sick
  // day risks capturing health data (GDPR special-category) -- see
  // schema.prisma's CalendarAbsence.reason comment. Mirrors the backend's
  // own MarkAbsenceSchema refine; the server remains authoritative.
  const reasonRequired = kind === "VACATION";

  const reset = () => {
    setDay("");
    setKind("SICK");
    setReason("");
    setFieldError(null);
  };

  const handleClose = () => {
    if (mark.pending) return;
    reset();
    onClose();
  };

  const onSubmit = () => {
    setFieldError(null);
    if (!day) {
      setFieldError("Date is required.");
      return;
    }
    if (reasonRequired && !reason.trim()) {
      setFieldError("Reason is required for a vacation absence.");
      return;
    }

    const trimmed = reason.trim();
    mark.run(
      () => calendarApi.markOwnAbsence({ day, kind, ...(trimmed ? { reason: trimmed } : {}) }),
      {
        onSuccess: async () => {
          await mutate(["my-absences"]);
          reset();
          onClose();
        },
      }
    );
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t("calendar.markAbsence")}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={mark.pending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={mark.pending}>
            Mark absence
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label={t("fields.date")}
          type="date"
          // Best-effort guard only, using the browser's local date (see
          // localToday()'s own comment: `toISOString()` would give the UTC
          // date, which disagrees with local for part of the day in any
          // non-UTC timezone) — the backend's own timezone-aware check
          // (ConflictError, "Cannot mark a past day sick or vacation")
          // remains the authoritative one and is surfaced via FormError
          // below if this client-side check somehow disagrees with it.
          min={localToday()}
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
        <Select
          label={t("fields.type")}
          value={kind}
          onChange={(e) => setKind(e.target.value as AbsenceKind)}
          options={[
            { value: "SICK", label: "Sick" },
            { value: "VACATION", label: "Vacation" },
          ]}
        />
        <Textarea
          label={reasonRequired ? "Reason" : "Reason (optional)"}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          // Deliberately non-medical framing: a SICK reason is optional and
          // must not invite health details (GDPR special-category) -- see
          // this component's reasonRequired comment and schema.prisma's
          // CalendarAbsence.reason.
          placeholder={reasonRequired ? "e.g. family trip, personal days" : "Optional"}
          // The do-not-enter-medical-details warning shows in BOTH states,
          // not only for SICK: someone can type the reason first and switch
          // kind after, and a warning that appears only once the sensitive
          // option is selected is easy to miss entirely.
          hint={`${reasonRequired ? "Required for vacation." : "Optional."} Do not enter medical details.`}
        />
        <FormError>{fieldError ?? mark.error}</FormError>
      </div>
    </Modal>
  );
}
