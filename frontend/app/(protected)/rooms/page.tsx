"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAssignments } from "@/hooks/useAssignments";
import { useHotel } from "@/hooks/useHotels";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useMyRooms, useRoomSuggestions } from "@/hooks/useRooms";
import { useAuthStore } from "@/stores/auth";
import { roomsApi } from "@/lib/api";
import { dayKeyInCalendarTimezone, todayKeyInCalendarTimezone } from "@/lib/calendar";
import { RoomStateBadge } from "@/components/rooms/RoomStateBadge";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  FormError,
  Input,
  Modal,
  PageHeader,
  Skeleton,
  TextLink,
} from "@/components/ui";
import type { RoomLog } from "@/lib/types";

/**
 * The worker's own room log — web parity with the mobile Rooms tab
 * (owner decision, 2026-09-01).
 *
 * The gap this closes: a worker had no way to record WHICH rooms they cleaned.
 * A manager typed a total afterwards and the checker typed a room number from
 * memory, so nothing connected the two. The worker logs each room as they
 * finish it, and the checker's picker is built from exactly these entries.
 *
 * Not gated behind a RoleGate: `GET /rooms/mine` is self-scoped for every role
 * (it takes no worker id at all), so a checker or manager who opens this URL
 * sees their own — empty — log rather than a blank screen. The LOG INPUT is
 * worker-only, because `POST /rooms/assignments/:id/rooms` is
 * `requireRole('worker')` and offering it to anyone else would be a button
 * that can only 403.
 */
export default function RoomsPage() {
  const { t } = useTranslation();
  const role = useAuthStore((s) => s.user?.role);
  const { data, isLoading, error, mutate } = useMyRooms();

  const rooms = data?.rooms ?? [];
  const needsRework = data?.needs_rework ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={t("rooms.title")} />

      {/* Rooms sent back, from ANY day, above today's list and outside the day
          filter on purpose: a rework raised yesterday is dated today by the
          server and has an escalation clock on it, so it must never be a
          scroll away. */}
      {needsRework.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("rooms.needsYourAttention")}</CardTitle>
          </CardHeader>
          <CardContent className="py-0">
            <ul>
              {needsRework.map((room) => (
                <RoomRow key={room.id} room={room} showHotel onChanged={mutate} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {role === "worker" && <LogRoomCard loggedToday={rooms} onLogged={mutate} />}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>{t("rooms.todayTitle")}</CardTitle>
          {!isLoading && !error && (
            <span className="text-sm text-gray-500 dark:text-gray-400">{rooms.length}</span>
          )}
        </CardHeader>
        <CardContent className="py-0">
          {error ? (
            <p className="py-6 text-center text-sm text-red-600 dark:text-red-400">
              {t("common.loadFailed")}
            </p>
          ) : isLoading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          ) : rooms.length === 0 ? (
            <EmptyState title={t("rooms.emptyToday")} />
          ) : (
            <ul>
              {rooms.map((room) => (
                <RoomRow key={room.id} room={room} onChanged={mutate} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The log input, plus the typeahead that makes the server's deliberately
 * conservative room matching workable (trim + upper-case only, so "0412" stays
 * a different room from "412" — the suggestions are what make spellings
 * converge instead).
 */
function LogRoomCard({
  loggedToday,
  onLogged,
}: {
  loggedToday: RoomLog[];
  onLogged: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [roomNumber, setRoomNumber] = useState("");
  const log = useAsyncAction();

  // The shift to log against.
  //
  // An IN_PROGRESS shift is the one the caller is checked into. A rework shift
  // is excluded because rooms belong to the ORIGINAL shift (the server 400s
  // otherwise, and the same room would otherwise show up twice in the
  // checker's picker).
  //
  // It must also be today's shift. Since `AssignmentDto` now carries a `day` field,
  // we can use it directly rather than trying to infer it from `started_at` and timezone
  // boundaries. The backend already dates assignments accurately in Europe/Berlin.
  const { assignments, isLoading: shiftsLoading } = useAssignments({
    status: "IN_PROGRESS",
    per_page: 5,
  });
  const today = todayKeyInCalendarTimezone();
  const activeShift = assignments?.find(
    (a) => !a.rework_of_assignment_id && a.day === today,
  );

  // Fallback for a worker who has already checked OUT and remembers one more
  // room: the server still accepts a COMPLETED shift. Its identity comes from
  // a room the server itself dated today, so this is the server telling us
  // which shift is today's rather than the client guessing.
  const shift = activeShift
    ? { assignmentId: activeShift.id, hotelId: activeShift.hotel_id, hotelName: null }
    : loggedToday.length > 0
      ? {
          assignmentId: loggedToday[0].assignment_id,
          hotelId: loggedToday[0].hotel_id,
          hotelName: loggedToday[0].hotel_name,
        }
      : null;

  const { data: hotel } = useHotel(shift?.hotelId);
  const { data: suggestionData } = useRoomSuggestions(shift?.hotelId);

  // Only suggestions that match what has been typed AND are not already
  // logged today: offering a room the worker cannot claim is a dead end (the
  // server answers 409, naming whoever logged it).
  const suggestions = useMemo(() => {
    const typed = roomNumber.trim().toUpperCase();
    if (!typed) return [];
    const already = new Set(loggedToday.map((r) => r.room_number.toUpperCase()));
    return (suggestionData?.rooms ?? [])
      .filter((r) => r.toUpperCase().startsWith(typed) && !already.has(r.toUpperCase()))
      .slice(0, 6);
  }, [roomNumber, suggestionData, loggedToday]);

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || !shift) return;
    log.run(() => roomsApi.log(shift.assignmentId, trimmed), {
      onSuccess: async () => {
        setRoomNumber("");
        await onLogged();
      },
      errorMessage: t("rooms.couldNotLog"),
    });
  };

  if (shiftsLoading && !shift) {
    return (
      <Card>
        <CardContent>
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!shift) {
    return (
      <Card>
        <CardContent className="text-sm text-gray-600 dark:text-gray-300">
          {t("rooms.checkInFirst")}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("rooms.addTitle")}</CardTitle>
        {(hotel?.name ?? shift.hotelName) && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {hotel?.name ?? shift.hotelName}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(roomNumber);
          }}
        >
          <div className="flex-1">
            <Input
              label={t("rooms.placeholder")}
              value={roomNumber}
              onChange={(e) => setRoomNumber(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={32}
              disabled={log.pending}
            />
          </div>
          <Button type="submit" loading={log.pending} disabled={roomNumber.trim() === ""}>
            {t("rooms.add")}
          </Button>
        </form>

        {suggestions.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => submit(s)}
                  disabled={log.pending}
                  // The visible label is just the room number, which on its own
                  // does not say what activating it does.
                  aria-label={`${t("rooms.add")} ${s}`}
                  className="rounded-full border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* The 409 names who already logged the room, which is the whole point
            of surfacing the server's own message: the usual cause is two people
            cleaning one corridor, not a mistake. */}
        <FormError>{log.error}</FormError>
      </CardContent>
    </Card>
  );
}

function RoomRow({
  room,
  showHotel = false,
  onChanged,
}: {
  room: RoomLog;
  showHotel?: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [editOpen, setEditOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  const openRework = room.state === "NEEDS_REWORK" && room.rework_assignment_id;

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 py-3 last:border-b-0 dark:border-gray-800">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
          {room.room_number}
        </p>
        {showHotel && (
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">
            {[room.hotel_name, room.day].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <RoomStateBadge state={room.state} />
        {openRework ? (
          // The rework is a separate shift (ADR-069), so this links to that
          // assignment rather than back to this room.
          <TextLink href={`/assignments/${room.rework_assignment_id}`} className="text-sm">
            {t("rooms.goToRework")}
          </TextLink>
        ) : (
          // `editable` goes false the moment an inspection references the log,
          // so a check can never be orphaned from the room it inspected. Both
          // affordances are withheld rather than shown-then-409'd.
          room.editable && (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                {t("common.edit")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRemoveOpen(true)}>
                {t("rooms.remove")}
              </Button>
            </>
          )
        )}
      </div>

      <EditRoomModal
        room={room}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onChanged={onChanged}
      />
      <RemoveRoomModal
        room={room}
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        onChanged={onChanged}
      />
    </li>
  );
}

function EditRoomModal({
  room,
  open,
  onClose,
  onChanged,
}: {
  room: RoomLog;
  open: boolean;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [roomNumber, setRoomNumber] = useState(room.room_number);
  const save = useAsyncAction();

  const handleClose = () => {
    if (save.pending) return;
    setRoomNumber(room.room_number);
    onClose();
  };

  const onSubmit = () => {
    const trimmed = roomNumber.trim();
    if (trimmed === "" || trimmed === room.room_number) return;
    save.run(() => roomsApi.update(room.id, trimmed), {
      onSuccess: async () => {
        await onChanged();
        onClose();
      },
      errorMessage: t("rooms.couldNotUpdate"),
    });
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t("rooms.editTitle")}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={save.pending}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={onSubmit}
            loading={save.pending}
            disabled={roomNumber.trim() === ""}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label={t("rooms.placeholder")}
          value={roomNumber}
          onChange={(e) => setRoomNumber(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={32}
        />
        <FormError>{save.error}</FormError>
      </div>
    </Modal>
  );
}

function RemoveRoomModal({
  room,
  open,
  onClose,
  onChanged,
}: {
  room: RoomLog;
  open: boolean;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const remove = useAsyncAction();

  const handleClose = () => {
    if (remove.pending) return;
    onClose();
  };

  const onConfirm = () =>
    remove.run(() => roomsApi.remove(room.id), {
      onSuccess: async () => {
        await onChanged();
        onClose();
      },
      errorMessage: t("rooms.couldNotRemove"),
    });

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t("rooms.removeTitle")}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={remove.pending}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={remove.pending}>
            {t("rooms.remove")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t("rooms.removeBody", { room: room.room_number })}
        </p>
        <FormError>{remove.error}</FormError>
      </div>
    </Modal>
  );
}
