"use client";

import { useState } from "react";
import { useNotifications } from "@/hooks/useNotifications";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useHotel } from "@/hooks/useHotels";
import { notificationsApi } from "@/lib/api";
import { NotificationTypeBadge } from "@/components/notifications/NotificationTypeBadge";
import { formatDateTime } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  FormError,
  PageHeader,
  Select,
  Table,
  THead,
  TBody,
  TableSkeleton,
  TR,
  TH,
  TD,
  TextLink,
} from "@/components/ui";
import type { Notification } from "@/lib/types";

const READ_FILTERS = [
  { value: "", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
];

const COLUMNS = 5;

function NotificationRow({ notification: n }: { notification: Notification }) {
  const { data: hotel } = useHotel(n.hotel_id ?? undefined);

  return (
    <TR>
      <TD className="font-medium">
        <TextLink href={`/notifications/${n.id}`} className="block">
          {n.title}
        </TextLink>
      </TD>
      <TD>
        <NotificationTypeBadge type={n.type} />
      </TD>
      <TD>{n.hotel_id ? hotel?.name ?? "—" : "—"}</TD>
      <TD>{formatDateTime(n.created_at)}</TD>
      <TD>
        {n.is_read ? <Badge tone="neutral">Read</Badge> : <Badge tone="info">Unread</Badge>}
      </TD>
    </TR>
  );
}

export default function NotificationsPage() {
  const { notifications, unreadCount, isLoading, error, mutate } =
    useNotifications();

  const [filter, setFilter] = useState<"" | "unread" | "read">("");
  const markAll = useAsyncAction();

  const visible: Notification[] = notifications.filter((n) =>
    filter === "" ? true : filter === "unread" ? !n.is_read : n.is_read,
  );

  const markAllRead = () => {
    const unread = notifications.filter((n) => !n.is_read);
    if (unread.length === 0) return;
    return markAll.run(
      () => Promise.all(unread.map((n) => notificationsApi.markAsRead(n.id))),
      {
        onSuccess: () => mutate(),
        errorMessage: "Failed to mark all as read. Please try again.",
      },
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description={
          unreadCount > 0
            ? `You have ${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}.`
            : "You're all caught up."
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={markAllRead}
            loading={markAll.pending}
            disabled={unreadCount === 0}
          >
            Mark all as read
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full sm:w-48">
          <Select
            label="Show"
            value={filter}
            onChange={(e) => setFilter(e.target.value as "" | "unread" | "read")}
            options={READ_FILTERS}
          />
        </div>
      </div>

      <FormError>{markAll.error}</FormError>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="px-6 py-10 text-center text-sm text-red-600">
              Failed to load notifications. Please try again.
            </div>
          ) : (
            <Table aria-label="Notifications">
              <THead>
                <tr>
                  <TH>Title</TH>
                  <TH>Type</TH>
                  <TH>Hotel</TH>
                  <TH>Received</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              {isLoading ? (
                <TableSkeleton columns={COLUMNS} />
              ) : visible.length === 0 ? (
                <TBody>
                  <tr>
                    <TD colSpan={COLUMNS} className="p-0">
                      <EmptyState
                        title="No notifications found"
                        description={
                          filter
                            ? "Try a different filter."
                            : "You'll see updates here as they arrive."
                        }
                      />
                    </TD>
                  </tr>
                </TBody>
              ) : (
                <TBody>
                  {visible.map((n) => (
                    <NotificationRow key={n.id} notification={n} />
                  ))}
                </TBody>
              )}
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
