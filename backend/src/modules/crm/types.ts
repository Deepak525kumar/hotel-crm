import { z } from 'zod';

export const CreateHotelSchema = z.object({
  name: z.string().min(1).max(200),
  city: z.string().min(1).max(100),
  country: z.string().min(1).max(100).default('Germany'),
  address: z.string().min(1).max(500),
  timezone: z.string().default('Europe/Berlin'),
});

export const UpdateHotelSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  city: z.string().min(1).max(100).optional(),
  country: z.string().min(1).max(100).optional(),
  address: z.string().min(1).max(500).optional(),
  timezone: z.string().optional(),
  is_active: z.boolean().optional(),
  // Epic 5 PR 5.3 (ADR-023): group assignment happens after hotel creation
  // ("after a hotel is created, it is assigned" — CRR §11), so this is
  // update-only, not part of CreateHotelSchema.
  hotel_group_id: z.string().min(1).optional(),
});

export const ListHotelsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  is_active: z.enum(['true', 'false']).optional(),
  country: z.string().optional(),
});

export type CreateHotelRequest = z.infer<typeof CreateHotelSchema>;
export type UpdateHotelRequest = z.infer<typeof UpdateHotelSchema>;
export type ListHotelsQuery = z.infer<typeof ListHotelsQuerySchema>;

// HotelGroup (Epic 5 PR 5.2, ADR-023): {id, name, billing_info, regional_manager_user_id}.
// Creation/modification is Admin-only (REQ-CRM-010: Regional/Property Managers "manage
// assigned hotels but not create hotels or modify hotel groups"). regional_manager_user_id
// is required — ADR-023: "One HotelGroup has exactly one assigned Regional Manager."
export const CreateHotelGroupSchema = z.object({
  name: z.string().min(1).max(200),
  billing_info: z.string().max(2000).optional(),
  regional_manager_user_id: z.string().min(1),
});

export const UpdateHotelGroupSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  billing_info: z.string().max(2000).optional(),
  regional_manager_user_id: z.string().min(1).optional(),
});

export const ListHotelGroupsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export type CreateHotelGroupRequest = z.infer<typeof CreateHotelGroupSchema>;
export type UpdateHotelGroupRequest = z.infer<typeof UpdateHotelGroupSchema>;
export type ListHotelGroupsQuery = z.infer<typeof ListHotelGroupsQuerySchema>;
