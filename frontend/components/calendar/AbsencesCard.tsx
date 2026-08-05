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
} from "@/components/ui";
import type { AbsenceKind, CalendarAbsence } from "@/lib/types";

const KIND_LABEL: Record<AbsenceKind, string> = {
  SICK: "Sick",
  VACATION: "Vacation",
};

const KIND_TONE: Record<AbsenceKind, "warning" | "neutral"> = {
  SICK: "warning",
  VACATION: "neutral",
};

function AbsenceRow({ absence }: { absence: CalendarAbsence }) {
  return (
    <li className="flex items-center justify-between gap-4 border-b border-gray-100 py-3 last:border-b-0">
      <p className="text-sm font-medium text-gray-900">{formatDate(absence.day)}</p>
      <Badge tone={KIND_TONE[absence.kind]}>{KIND_LABEL[absence.kind]}</Badge>
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
  const { data: absences, isLoading, error } = useOwnAbsences();
  const [markOpen, setMarkOpen] = useState(false);

  return (
    <>
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Absences</CardTitle>
          <Button size="sm" onClick={() => setMarkOpen(true)}>
            Mark absence
          </Button>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="py-6 text-center text-sm text-red-600">
              Failed to load your absences.
            </p>
          ) : isLoading ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          ) : !absences || absences.length === 0 ? (
            <EmptyState
              title="No absences recorded"
              description="Sick days and vacation you mark appear here."
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
  const [day, setDay] = useState("");
  const [kind, setKind] = useState<AbsenceKind>("SICK");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const mark = useAsyncAction();

  const reset = () => {
    setDay("");
    setKind("SICK");
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

    mark.run(() => calendarApi.markOwnAbsence({ day, kind }), {
      onSuccess: async () => {
        await mutate(["my-absences"]);
        reset();
        onClose();
      },
    });
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Mark absence"
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
          label="Date"
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
          label="Type"
          value={kind}
          onChange={(e) => setKind(e.target.value as AbsenceKind)}
          options={[
            { value: "SICK", label: "Sick" },
            { value: "VACATION", label: "Vacation" },
          ]}
        />
        <FormError>{fieldError ?? mark.error}</FormError>
      </div>
    </Modal>
  );
}
