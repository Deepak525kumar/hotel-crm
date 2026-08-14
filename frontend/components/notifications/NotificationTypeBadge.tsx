import { Badge } from "@/components/ui";
import type { NotificationType } from "@/lib/types";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

/** Maps each notification type to a Badge tone + human label. */
const TYPES: Record<NotificationType, { tone: Tone; label: string }> = {
  WORK_REQUEST_PUBLISHED: { tone: "info", label: "Request published" },
  JOB_REQUEST_BROADCAST: { tone: "info", label: "Broadcast received" },
  WORK_REQUEST_CANCELLED: { tone: "danger", label: "Request cancelled" },
  WORK_REQUEST_EXPIRING_SOON: { tone: "warning", label: "Request expiring" },
  APPLICATION_RECEIVED: { tone: "info", label: "Application received" },
  APPLICATION_ACCEPTED: { tone: "success", label: "Application accepted" },
  APPLICATION_REJECTED: { tone: "danger", label: "Application rejected" },
  APPLICATION_WITHDRAWN: { tone: "warning", label: "Application withdrawn" },
  ASSIGNMENT_CONFIRMED: { tone: "success", label: "Assignment confirmed" },
  ASSIGNMENT_CANCELLED: { tone: "danger", label: "Assignment cancelled" },
  SHIFT_REMINDER: { tone: "info", label: "Shift reminder" },
  CHECK_IN_REMINDER: { tone: "warning", label: "Check-in reminder" },
  ATTENDANCE_VERIFIED: { tone: "success", label: "Attendance verified" },
  WORKER_NO_SHOW: { tone: "danger", label: "Worker no-show" },
  QUALITY_VERIFICATION_SUBMITTED: { tone: "info", label: "Quality submitted" },
  RATING_RECEIVED: { tone: "info", label: "Rating received" },
  REWORK_REQUIRED: { tone: "warning", label: "Rework required" },
};

/** Human-readable label for a notification type (falls back to the raw value). */
export function notificationTypeLabel(type: NotificationType): string {
  return TYPES[type]?.label ?? type;
}

export function NotificationTypeBadge({ type }: { type: NotificationType }) {
  const meta = TYPES[type] ?? { tone: "neutral" as Tone, label: type };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
