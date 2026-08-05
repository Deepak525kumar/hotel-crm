import { z } from 'zod';

export const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  phone: z.string().optional(),
  // `regional_manager` added (Regional Manager V1 lifecycle PR): POST /users
  // is requireRole('admin')-only, so no elevation-guard exercise like
  // updateUser's role !== 'admin' check applies — every caller who reaches
  // this schema is already an admin.
  role: z.enum(['worker', 'checker', 'manager', 'admin', 'regional_manager']).default('worker'),
});

// LEGACY — used only while FEATURE_GD02_MATRIX is off (rollback path). This
// is the exact schema the C-15 defect lived in (ADR-030 D-4a): whether a
// caller may touch `role` was decided by an `if` inside the service, not by
// the route/schema. Kept unmodified for the flag-off compatibility
// guarantee; do not extend it — extend UpdateUserProfileSchema instead.
export const UpdateUserSchema = z.object({
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  phone: z.string().nullable().optional(),
  role: z.enum(['worker', 'checker', 'manager', 'admin']).optional(),
  is_active: z.boolean().optional(),
});

// ADR-030 D-4a: the split half of PUT /users/:id that a scoped manager or
// regional_manager may call. `.strict()` means an incoming `role` key (or
// any other unknown key) fails validation at the schema boundary — the
// caller gets a 400, and `role` is never even read, let alone reaches the
// service. This is what makes D-4's `users:write` grant safe to extend to a
// scoped role: the DTO itself cannot express a role change.
export const UpdateUserProfileSchema = z
  .object({
    first_name: z.string().min(1).max(100).optional(),
    last_name: z.string().min(1).max(100).optional(),
    phone: z.string().nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

// ADR-030 D-4a: the dedicated, Admin-only role-assignment endpoint
// (PUT /users/:id/role). `.strict()` so no profile field can ride along —
// this route does exactly one thing.
export const UpdateUserRoleSchema = z
  .object({
    role: z.enum(['worker', 'checker', 'manager', 'admin', 'regional_manager']),
  })
  .strict();

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
export type UpdateUserProfileRequest = z.infer<typeof UpdateUserProfileSchema>;
export type UpdateUserRoleRequest = z.infer<typeof UpdateUserRoleSchema>;
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;
