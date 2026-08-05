// SPEC-GEO-001 @0.1.2 FROZEN (GD-14 Decided 2026-07-27).
// TREQ-GEO-001..006 / RULE-GEO-001..004.

import { z } from 'zod';

// REQ-CRM/GD-14/OD-GEO-001: the geofence radius. CRR §17 line 264 originally
// chose 100m for GPS drift near large buildings; tightened to 30m per
// explicit product decision (2026-08-05). Not yet a per-hotel-configurable
// schema field (CRR §17 leaves that for later).
export const GEOFENCE_RADIUS_METERS = 30;

// TREQ-GEO-005/RULE-GEO-004 (Tier 1, CRR §25 line 333): "6 months, then hard
// delete."
export const RETENTION_MONTHS = 6;

export const CheckinSchema = z.object({
  hotel_id: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export type CheckinInput = z.infer<typeof CheckinSchema>;

export const ListCheckinsQuerySchema = z.object({
  worker_id: z.string().optional(),
  hotel_id: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListCheckinsQuery = z.infer<typeof ListCheckinsQuerySchema>;

// RULE-GEO-003/OD-GEO-005: distance/pass-fail only. latitude/longitude are
// intentionally NOT part of this DTO -- admin/manager (and the worker
// themself, TRULE-GEO-003) never receive raw coordinates back from any API.
export interface GeoCheckinDto {
  id: string;
  worker_id: string;
  hotel_id: string;
  distance_meters: number;
  inside_radius: boolean;
  checked_at: string;
}
