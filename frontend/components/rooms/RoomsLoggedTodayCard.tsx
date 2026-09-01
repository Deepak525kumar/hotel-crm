"use client";

import { useTranslation } from "react-i18next";
import { useRoomsForHotel } from "@/hooks/useRooms";
import { RoomStateBadge } from "@/components/rooms/RoomStateBadge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";

/**
 * What the workers at this hotel have logged today, per worker and room
 * (owner decision, 2026-09-01).
 *
 * This is what replaced the manual "rooms completed" count a manager used to
 * type in after each shift: the number is now a consequence of the workers'
 * own per-room records rather than a second, hand-entered source of truth that
 * nothing reconciled against the first.
 *
 * `GET /rooms/for-hotels` is scoped server-side (manager/RM see their JWT
 * scope, admin sees everything) and the `hotel_id` passed here can only NARROW
 * that — an out-of-scope hotel answers 403 rather than an empty list, so the
 * parameter cannot be used to probe another group's activity. Nothing is
 * filtered client-side: a client-side filter over a wider response would be a
 * disclosure, not a gate.
 *
 * The day is deliberately not sent. "Today" is resolved in the platform
 * calendar timezone (Europe/Berlin) server-side, so a browser-computed date
 * would show the previous day's rooms for the first two hours of every day.
 */
export function RoomsLoggedTodayCard({ hotelId }: { hotelId: string }) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useRoomsForHotel(hotelId);

  const byWorker = data?.by_worker ?? [];
  const rooms = data?.rooms ?? [];

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>{t("rooms.hotelTodayTitle")}</CardTitle>
        {!isLoading && !error && (
          <span className="text-sm text-gray-500 dark:text-gray-400">{rooms.length}</span>
        )}
      </CardHeader>

      {error ? (
        <CardContent>
          <p className="py-6 text-center text-sm text-red-600 dark:text-red-400">
            {t("common.loadFailed")}
          </p>
        </CardContent>
      ) : isLoading ? (
        <CardContent className="space-y-3">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
        </CardContent>
      ) : rooms.length === 0 ? (
        <CardContent className="p-0">
          <EmptyState title={t("rooms.emptyToday")} />
        </CardContent>
      ) : (
        <>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH scope="col">{t("fields.worker")}</TH>
                  <TH scope="col" className="text-end">
                    {t("rooms.roomsLogged")}
                  </TH>
                </TR>
              </THead>
              <TBody>
                {byWorker.map((entry) => (
                  <TR key={entry.worker_id}>
                    {/* worker_name is nullable server-side (a deleted account
                        keeps its rooms), so the count still has a row rather
                        than vanishing from the totals. */}
                    <TD>{entry.worker_name ?? entry.worker_id}</TD>
                    <TD className="text-end font-medium">{entry.rooms_logged}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>

          <CardContent className="border-t border-gray-100 dark:border-gray-800">
            <ul className="space-y-2">
              {rooms.map((room) => (
                <li
                  key={room.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {room.room_number}
                    </span>
                    {room.worker_name && (
                      <span className="ms-2 text-gray-500 dark:text-gray-400">
                        {room.worker_name}
                      </span>
                    )}
                  </span>
                  <RoomStateBadge state={room.state} />
                </li>
              ))}
            </ul>
          </CardContent>
        </>
      )}
    </Card>
  );
}
