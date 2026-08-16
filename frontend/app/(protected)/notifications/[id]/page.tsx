"use client";

import { useParams } from "next/navigation";
import { useNotification } from "@/hooks/useNotifications";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { useHotel, useUsersByIds } from "@/hooks/useHotels";
import { notificationsApi } from "@/lib/api";
import {
  NotificationTypeBadge,
  notificationTypeLabel,
} from "@/components/notifications/NotificationTypeBadge";
import { formatDateTime } from "@/lib/format";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataList,
  DataRow,
  FormError,
  PageHeader,
  Skeleton,
  TextLink,
} from "@/components/ui";
import { BackLink } from "@/components/ui/BackLink";

/**
 * `Notification.data` carries arbitrary resource ids for deep-linking (see
 * the backend modules' `notificationService.enqueue(...)` call sites). Map
 * the known id-shaped keys to their detail routes instead of dumping the
 * raw id as unlinked text.
 */
const DATA_KEY_ROUTES: Record<string, (v: string) => string> = {
  assignment_id: (v) => `/assignments/${v}`,
  previous_assignment_id: (v) => `/assignments/${v}`,
  work_request_id: (v) => `/requests/${v}`,
  job_request_id: (v) => `/requests/broadcasts/${v}`,
  request_id: (v) => `/requests/${v}`,
  attendance_id: (v) => `/attendance/${v}`,
  worker_id: (v) => `/users/${v}`,
  new_worker_id: (v) => `/users/${v}`,
  unassigned_by_id: (v) => `/users/${v}`,
  actor_id: (v) => `/users/${v}`,
  user_id: (v) => `/users/${v}`,
  hotel_id: (v) => `/hotels/${v}`,
};

/** Keys whose value is a user id we can resolve to a display name. */
const USER_DATA_KEYS = new Set([
  "worker_id",
  "new_worker_id",
  "unassigned_by_id",
  "actor_id",
  "user_id",
]);

const DATA_KEY_LABELS: Record<string, string> = {
  assignment_id: "Assignment",
  previous_assignment_id: "Previous assignment",
  work_request_id: "Work request",
  job_request_id: "Broadcast",
  request_id: "Request",
  attendance_id: "Attendance record",
  worker_id: "Worker",
  new_worker_id: "New worker",
  unassigned_by_id: "Unassigned by",
  actor_id: "Actor",
  user_id: "User",
  hotel_id: "Hotel",
};

export default function NotificationDetailPage() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const { id } = params;

  const { notification, isLoading, error, mutate } = useNotification(id);
  const { data: hotel } = useHotel(notification?.hotel_id ?? undefined);
  const dataUserIds = notification?.data
    ? Object.entries(notification.data)
        .filter(([key]) => USER_DATA_KEYS.has(key))
        .map(([, value]) => String(value))
    : [];
  const usersById = useUsersByIds(dataUserIds);

  const mark = useAsyncAction();

  const markRead = () =>
    mark.run(() => notificationsApi.markAsRead(id), {
      onSuccess: () => mutate(),
      errorMessage: "Failed to mark as read. Please try again.",
    });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-4 w-32" />
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !notification) {
    return (
      <div className="space-y-4">
        <BackLink href="/notifications" className="text-sm" labelKey="common.backTo.notifications" />
        <Card>
          <CardContent className="text-sm text-red-600 dark:text-red-400">
            {t("notifications.viewOneFailed")}
          </CardContent>
        </Card>
      </div>
    );
  }

  // `data` carries arbitrary resource ids for deep-linking; render any present.
  const dataEntries = notification.data
    ? Object.entries(notification.data)
    : [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <BackLink href="/notifications" className="text-sm" labelKey="common.backTo.notifications" />
        <PageHeader
          className="mt-2"
          title={notification.title}
          actions={
            <div className="flex items-center gap-2">
              <NotificationTypeBadge type={notification.type} />
              {notification.is_read ? (
                <Badge tone="neutral">{t("status.read")}</Badge>
              ) : (
                <Badge tone="info">{t("status.unread")}</Badge>
              )}
            </div>
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("common.message")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-line text-sm text-gray-900 dark:text-gray-100">
            {notification.message}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("common.details")}</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <DataList>
            <DataRow
              label={t("fields.type")}
              value={notificationTypeLabel(notification.type)}
            />
            <DataRow label={t("notifications.channel")} value={notification.channel} />
            <DataRow
              label={t("status.received")}
              value={formatDateTime(notification.created_at)}
            />
            <DataRow label={t("notifications.readAt")} value={formatDateTime(notification.read_at)} />
            {notification.hotel_id && (
              <DataRow
                label={t("fields.hotel")}
                value={
                  <TextLink href={`/hotels/${notification.hotel_id}`}>
                    {hotel?.name ?? "View hotel"}
                  </TextLink>
                }
              />
            )}
            {dataEntries.map(([key, value]) => {
              const stringValue = String(value);
              const toHref = DATA_KEY_ROUTES[key];
              const user = USER_DATA_KEYS.has(key) ? usersById.get(stringValue) : undefined;
              const linkText = user
                ? `${user.first_name} ${user.last_name}`
                : key === "hotel_id" && hotel
                  ? hotel.name
                  : "View";
              return (
                <DataRow
                  key={key}
                  label={DATA_KEY_LABELS[key] ?? key}
                  value={
                    toHref ? (
                      <TextLink href={toHref(stringValue)}>{linkText}</TextLink>
                    ) : (
                      stringValue
                    )
                  }
                />
              );
            })}
          </DataList>
        </CardContent>
      </Card>

      <FormError>{mark.error}</FormError>

      {!notification.is_read && (
        <Card>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {t("notifications.markReadHint")}
            </div>
            <Button onClick={markRead} loading={mark.pending} className="shrink-0">
              {t("notifications.markAsReadAction")}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
