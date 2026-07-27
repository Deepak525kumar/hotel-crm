import { Badge } from "@/components/ui";

/**
 * Pass/fail result of a geofence distance check (SPEC-GEO-001, GD-14).
 * `inside_radius` is the only pass/fail signal the backend ever returns —
 * never a raw distance threshold or coordinates (RULE-GEO-003/OD-GEO-005).
 */
export function GeofenceResultBadge({ insideRadius }: { insideRadius: boolean }) {
  return insideRadius ? (
    <Badge tone="success">At hotel</Badge>
  ) : (
    <Badge tone="danger">Outside geofence</Badge>
  );
}
