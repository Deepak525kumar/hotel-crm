import { Badge } from "@/components/ui";

/**
 * Today-only red/green availability signal (SPEC-CALENDAR-001 REQ-CAL-T06,
 * RULE-CAL-08). Never implies anything about any other day — the backend
 * itself has no `day` concept for this read.
 */
export function AvailabilityBadge({ available }: { available: boolean }) {
  return available ? (
    <Badge tone="success">Free today</Badge>
  ) : (
    <Badge tone="warning">Assigned or on leave today</Badge>
  );
}
