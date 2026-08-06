import { z } from 'zod';

// Manager-vacancy model (2026-08-06): shared by Hotel.manager_user_id and
// HotelGroup.regional_manager_user_id clears. NOT_ASSIGNED is the server's
// own default when a clear is sent with no explicit reason (e.g. an
// automated demotion path) -- callers requesting a specific reason should
// send one of the other five values.
export const ManagerVacancyReasonSchema = z.enum([
  'NOT_ASSIGNED',
  'DEMOTED',
  'RESIGNED',
  'TERMINATED',
  'TRANSFERRED',
  'TEMPORARY',
]);

export const CreateHotelSchema = z.object({
  name: z.string().min(1).max(200),
  city: z.string().min(1).max(100),
  country: z.string().min(1).max(100).default('Germany'),
  address: z.string().min(1).max(500),
  timezone: z.string().default('Europe/Berlin'),
  // GD-14/OD-GEO-001/004 (SPEC-GEO-001): hotel-coordinate source of truth,
  // admin-only manual entry (this route is already admin-only per
  // requireRoleFlagged(['admin','manager'], 'admin') in routes.ts — no new
  // permission/role gate needed). No geocoding-from-address service.
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export const UpdateHotelSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  city: z.string().min(1).max(100).optional(),
  country: z.string().min(1).max(100).optional(),
  address: z.string().min(1).max(500).optional(),
  timezone: z.string().optional(),
  is_active: z.boolean().optional(),
  // GD-05: per-hotel "pause new jobs" toggle (REQ-CRM-008).
  accepting_jobs: z.boolean().optional(),
  // Epic 5 PR 5.3 (ADR-023): group assignment happens after hotel creation
  // ("after a hotel is created, it is assigned" — CRR §11), so this is
  // update-only, not part of CreateHotelSchema. `null` clears the
  // assignment (distinct from omitting the field, which leaves it as-is).
  hotel_group_id: z.string().min(1).nullable().optional(),
  // Person-centric assignment redesign (2026-08-07): manager_user_id /
  // manager_vacancy_reason REMOVED from this schema. `Hotel.manager_user_id`
  // is now written exclusively by users/service.ts#updateUserRole (PUT
  // /users/:id/role) — the two-writer split (this method + updateUserRole)
  // was the exact bug this redesign fixes: only updateUserRole had correct
  // vacate-on-demotion logic, so a manager's role changing via this endpoint
  // could leave a stale manager_user_id pointer behind.
  // GD-14/OD-GEO-001/004 (SPEC-GEO-001): hotel-coordinate source of truth,
  // admin-only manual entry (this route is already admin-only per
  // requireRoleFlagged(['admin','manager'], 'admin') in routes.ts — no new
  // permission/role gate needed). No geocoding-from-address service.
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export const ListHotelsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  is_active: z.enum(['true', 'false']).optional(),
  country: z.string().optional(),
  // Filters hotels belonging to a specific HotelGroup (frontend: the hotel
  // group detail page's "Hotels in this group" list). Previously the only
  // way to get this was fetching a flat page of hotels (capped at `limit`'s
  // max of 100) and filtering client-side -- silently dropping any group
  // hotels past the first 100 hotels platform-wide, or when the group's
  // hotels weren't sorted into that first page at all.
  hotel_group_id: z.string().optional(),
});

export type CreateHotelRequest = z.infer<typeof CreateHotelSchema>;
export type UpdateHotelRequest = z.infer<typeof UpdateHotelSchema>;
export type ListHotelsQuery = z.infer<typeof ListHotelsQuerySchema>;

// HotelGroup (Epic 5 PR 5.2, ADR-023): {id, name, billing_info, regional_manager_user_id}.
// Creation/modification is Admin-only (REQ-CRM-010: Regional/Property Managers "manage
// assigned hotels but not create hotels or modify hotel groups").
//
// Person-centric assignment redesign (2026-08-07): regional_manager_user_id
// REMOVED from both schemas below. `HotelGroup.regional_manager_user_id` is
// now written exclusively by users/service.ts#updateUserRole (PUT
// /users/:id/role) — this method no longer accepts it at all. A HotelGroup
// may therefore be created (or left) with no RM assigned yet; this is a
// legitimate transitional state, mirroring the existing vacancy model
// already in place for a Hotel with no manager (ManagerVacancyReason /
// NOT_ASSIGNED). The RM is assigned afterward via the person-centric flow.
export const CreateHotelGroupSchema = z.object({
  name: z.string().min(1).max(200),
  billing_info: z.string().max(2000).optional(),
});

export const UpdateHotelGroupSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  billing_info: z.string().max(2000).optional(),
});

export const ListHotelGroupsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export type CreateHotelGroupRequest = z.infer<typeof CreateHotelGroupSchema>;
export type UpdateHotelGroupRequest = z.infer<typeof UpdateHotelGroupSchema>;
export type ListHotelGroupsQuery = z.infer<typeof ListHotelGroupsQuerySchema>;
