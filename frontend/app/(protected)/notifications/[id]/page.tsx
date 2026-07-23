"use client";

import { useParams } from "next/navigation";
import { useNotification } from "@/hooks/useNotifications";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { notificationsApi } from "@/lib/api";
import {
  NotificationTypeBadge,
  notificationTypeLabel,
} from "@/components/notifications/NotificationTypeBadge";
import { formatDateTime } from "@/lib/format";
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

export default function NotificationDetailPage() {
  const params = useParams<{ id: string }>();
  const { id } = params;

  const { notification, isLoading, error, mutate } = useNotification(id);

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
        <TextLink
          href="/notifications"
          className="text-sm"
        >
          ← Back to notifications
        </TextLink>
        <Card>
          <CardContent className="text-sm text-red-600">
            This notification was not found or could not be loaded.
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
        <TextLink
          href="/notifications"
          className="text-sm"
        >
          ← Back to notifications
        </TextLink>
        <PageHeader
          className="mt-2"
          title={notification.title}
          actions={
            <div className="flex items-center gap-2">
              <NotificationTypeBadge type={notification.type} />
              {notification.is_read ? (
                <Badge tone="neutral">Read</Badge>
              ) : (
                <Badge tone="info">Unread</Badge>
              )}
            </div>
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Message</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-line text-sm text-gray-900">
            {notification.message}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <DataList>
            <DataRow
              label="Type"
              value={notificationTypeLabel(notification.type)}
            />
            <DataRow label="Channel" value={notification.channel} />
            <DataRow
              label="Received"
              value={formatDateTime(notification.created_at)}
            />
            <DataRow label="Read at" value={formatDateTime(notification.read_at)} />
            {dataEntries.map(([key, value]) => (
              <DataRow key={key} label={key} value={String(value)} />
            ))}
          </DataList>
        </CardContent>
      </Card>

      <FormError>{mark.error}</FormError>

      {!notification.is_read && (
        <Card>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="text-sm text-gray-600">
              Mark this notification as read once you&apos;ve seen it.
            </div>
            <Button onClick={markRead} loading={mark.pending} className="shrink-0">
              Mark as read
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
