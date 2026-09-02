import { z } from 'zod';
import { SkillTag } from '@prisma/client';

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
    // Onboarding fields removed from schema per request
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
    // A worker's skills, collected on the same form and threaded into the
    // EmploymentRecord (createEmployee has always accepted them).
    //
    // Fixes a silent discard: the create form has offered these checkboxes
    // since it was built, this schema had no field for them, and Zod strips
    // unknown keys -- so every worker created through the UI was saved with
    // no skills at all, and skills drive job matching. Optional (owner
    // decision, 2026-09-02): they can be set later from the profile.
    //
    // .preprocess because POST /users is multipart (the mandatory photo), and
    // multipart has no array type -- the client sends one JSON string, the
    // same trick quality/validation.ts uses for criteria_scores. A repeated
    // field arrives as a real array already and is passed straight through.
    skills: z
      .preprocess((val) => {
        if (typeof val !== 'string') return val;
        if (val.trim() === '') return undefined;
        try {
          return JSON.parse(val);
        } catch {
          // Left as the raw string so the enum check below reports it,
          // rather than silently dropping the field the way the missing
          // schema entry used to.
          return val;
        }
      }, z.array(z.nativeEnum(SkillTag)))
      .optional(),
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

// The dedicated email-change endpoint (PUT /users/:id/email), Admin and
// Regional Manager only. Deliberately NOT a field on UpdateUserSchema /
// UpdateUserProfileSchema, for exactly the reason `role` is not: PUT /users/:id
// admits a scoped `manager`, and `.strict()` on a dedicated DTO is what makes
// it impossible for that role to express the change at all -- it fails at the
// schema boundary rather than relying on a service-layer check nobody
// remembers to add.
//
// Lowercased to match LoginSchema and PasswordResetRequestSchema: the user
// lookup is by literal email, so a mixed-case address here would lock the
// account out of its own login and password-reset paths.
export const UpdateUserEmailSchema = z
  .object({
    email: z.string().email('Invalid email address').toLowerCase(),
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
