import { z } from 'zod';

// ADR-065 (Universal Onboarding Gate, ratified 2026-08-11): every non-Admin
// account -- Worker, Checker, Manager, AND Regional Manager -- must get an
// EmploymentRecord (Pending) the moment the account is created, so the new
// user can self-service their own onboarding (documents, contract,
// submit-for-review) immediately on first login. RULE A (2026-08-12) is a
// separate, narrower decision governing WHO may create WHICH role (route
// gate: admin/regional_manager/manager, per lib/role-hierarchy.ts) -- POST
// /users is no longer admin-only, so job_title/start_date/employment_type
// are collected here and threaded into employeeManagementService.createEmployee()
// (users/service.ts#createUser) rather than left to a separate manual
// "Start onboarding" step, which no longer exists.
export const CreateUserSchema = z
  .object({
    // Lowercased so an admin-created account is stored the same way signup
    // stores one. Postgres' unique index on User.email is case-sensitive, so
    // without this "John@x.com" and "john@x.com" are two different accounts.
    email: z.string().email().toLowerCase(),
    password: z.string().min(8),
    first_name: z.string().min(1).max(100),
    last_name: z.string().min(1).max(100),
    phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number'),
    role: z.enum(['worker', 'checker', 'manager', 'admin', 'regional_manager']).default('worker'),
    // Required for every non-admin role (enforced below, not by .optional()
    // alone, since Zod has no native "required unless X" for a sibling
    // field) -- admin accounts have no onboarding/EmploymentRecord concept.
    job_title: z.string().min(1).max(200).optional(),
    start_date: z.coerce.date().optional(),
    employment_type: z.enum(['FULL_TIME', 'PART_TIME']).optional(),
    // COMPLIANCE (2026-08-13 audit finding): without this the flag defaulted
    // to false for EVERY account created through the normal UI, so the
    // document-completeness check never demanded a WORK_PERMIT from anyone --
    // a legal-compliance hole, not merely a missing field. Optional in the
    // schema but defaulted explicitly at the call site; ADR-065 §6 item 8 is
    // clear that this is set by the creating actor at creation time and is
    // NOT inferred from nationality.
    work_permit_required: z.boolean().optional(),
    // The assignment the creating actor intends for this account: a hotel for
    // a Manager, a group for a Regional Manager. These become the employment
    // record's TARGET fields, never its live scope -- ADR-065 Decision 2 is
    // that no operational scope exists until the application is approved and
    // assigned. Without them the /users/new selector was inert: the form sent
    // the chosen hotel/group, Zod stripped it as an unknown key, and the
    // record was created with the target null, so the reviewer had nothing to
    // assign from and the choice was silently lost.
    hotel_id: z.string().min(1).optional(),
    hotel_group_id: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === 'admin') return;
    if (!data.job_title) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['job_title'], message: 'job_title is required' });
    }
    if (!data.start_date) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['start_date'], message: 'start_date is required' });
    }
    if (!data.employment_type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['employment_type'],
        message: 'employment_type is required (FULL_TIME or PART_TIME)',
      });
    }
  });

// LEGACY — used only while FEATURE_GD02_MATRIX is off (rollback path). This
// is the exact schema the C-15 defect lived in (ADR-030 D-4a): whether a
// caller may touch `role` was decided by an `if` inside the service, not by
// the route/schema. Kept unmodified for the flag-off compatibility
// guarantee; do not extend it — extend UpdateUserProfileSchema instead.
//
// Person-centric assignment redesign (2026-08-07): `role` REMOVED. This was
// the second of two independent role-change paths (the other being
// PUT /users/:id/role -> updateUserRole) and, unlike that one, had NO logic
// to vacate a stale Hotel.manager_user_id / HotelGroup.regional_manager_user_id
// when a Manager/RM's role changed here — a real data-integrity bug (a user
// could keep showing as a hotel's Manager after losing the role via this
// endpoint). updateUserRole is now the SOLE path for role and
// manager/RM/group assignment changes; this method only ever touches
// first_name/last_name/phone/is_active.
export const UpdateUserSchema = z.object({
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number').nullable().optional(),
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
    phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number').nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

// ADR-030 D-4a: the dedicated, Admin-only role-assignment endpoint
// (PUT /users/:id/role). `.strict()` so no profile field can ride along —
// this route does exactly one thing (role + the assignment that goes with it).
//
// Person-centric assignment redesign (2026-08-07): this is now the SOLE
// write path for Hotel.manager_user_id / HotelGroup.regional_manager_user_id
// / EmploymentRecord.hotel_group_id + primary_hotel_id — see
// users/service.ts#updateUserRole for the full transaction. Field usage by
// target role:
//   - role: 'manager'          -> hotel_id required
//   - role: 'regional_manager' -> hotel_group_id required
//   - role: 'worker'|'checker' -> hotel_group_id optional (existing
//                                 eligibility semantics, unchanged), plus
//                                 primary_hotel_id optional (new,
//                                 display/default-selection only — never an
//                                 eligibility check, see roster-scope.ts)
//   - role: 'admin'            -> none of the above apply
export const UpdateUserRoleSchema = z
  .object({
    role: z.enum(['worker', 'checker', 'manager', 'admin', 'regional_manager']),
    hotel_id: z.string().min(1).optional(),
    hotel_group_id: z.string().min(1).optional(),
    primary_hotel_id: z.string().min(1).nullable().optional(),
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
