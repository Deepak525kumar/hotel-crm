import { z } from 'zod';

export const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  phone: z.string().optional(),
  role: z.enum(['worker', 'checker', 'manager', 'admin']).default('worker'),
});

export const UpdateUserSchema = z.object({
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  phone: z.string().optional(),
  role: z.enum(['worker', 'checker', 'manager', 'admin']).optional(),
  is_active: z.boolean().optional(),
});

export const ListUsersQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  // ADR-030 PR-3: 'regional_manager' widened here only (a read filter), not
  // in CreateUserSchema/UpdateUserSchema — role *assignment* stays exactly as
  // gated today (Admin-only, no regional_manager grant path exists yet).
  // This lets GET /users?role=regional_manager parse once M-3 promotes any
  // user; it grants no new permission and changes no write behavior.
  role: z.enum(['worker', 'checker', 'manager', 'admin', 'regional_manager']).optional(),
  hotel_id: z.string().optional(),
  search: z.string().optional(),
  is_active: z.enum(['true', 'false']).optional(),
});

export type CreateUserRequest = z.infer<typeof CreateUserSchema>;
export type UpdateUserRequest = z.infer<typeof UpdateUserSchema>;
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;
