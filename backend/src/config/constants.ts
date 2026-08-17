export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  SERVICE_UNAVAILABLE: 503,
} as const;

export const ERROR_CODES = {
  // Auth errors (401/403)
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  // ADR-031 D-3.2 (PR-3): distinct from TOKEN_EXPIRED/TOKEN_INVALID so
  // clients can tell "re-authenticate now" (this code) apart from "refresh
  // and retry" (the other two) — see ADR-031 C-7 / PR-4a.
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  INSUFFICIENT_PERMISSION: 'INSUFFICIENT_PERMISSION',
  UNAUTHORIZED: 'UNAUTHORIZED',

  // Validation errors (400)
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_ENUM_VALUE: 'INVALID_ENUM_VALUE',
  INVALID_FORMAT: 'INVALID_FORMAT',
  INVALID_REQUEST: 'INVALID_REQUEST',

  // Resource errors (404/409)
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_ALREADY_EXISTS: 'RESOURCE_ALREADY_EXISTS',
  CONCURRENCY_VIOLATION: 'CONCURRENCY_VIOLATION',
  OPERATION_NOT_ALLOWED: 'OPERATION_NOT_ALLOWED',

  // Business logic errors (422)
  WORKER_ALREADY_ASSIGNED: 'WORKER_ALREADY_ASSIGNED',
  TASK_ALREADY_COMPLETED: 'TASK_ALREADY_COMPLETED',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  GDPR_CONSTRAINT_VIOLATION: 'GDPR_CONSTRAINT_VIOLATION',
  CANNOT_ACCESS_HOTEL: 'CANNOT_ACCESS_HOTEL',
  CANNOT_ACCESS_RESOURCE: 'CANNOT_ACCESS_RESOURCE',

  // Not implemented (501)
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',

  // System errors (500/503)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  REDIS_ERROR: 'REDIS_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // Forbidden (403)
  FORBIDDEN: 'FORBIDDEN',
  // RULE-CONSENT-01: the daily GDPR access gate is not satisfied. A 403
  // distinct from FORBIDDEN because it is not a permissions failure and the
  // remedy is different -- the caller must present the notice and record a
  // decision, not request access. Clients key their consent wall on this.
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
} as const;

export const ROLE_HIERARCHY = {
  admin: 1,
  manager: 2,
  checker: 3,
  worker: 4,
} as const;

export const REQUEST_ID_PREFIX = 'req_';
export const ID_PREFIXES = {
  USER: 'user_',
  ROLE: 'role_',
  PERMISSION: 'perm_',
  SESSION: 'sess_',
  TOKEN: 'tok_',
} as const;

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

// RBAC: permissions granted to each role
//
// ADR-030 PR-5 (§3): this constant is source-of-truth for NEW/newly-promoted
// accounts (createUser, updateUserRole) immediately, but has zero effect on
// any EXISTING account's stored `User.permissions` snapshot until M-2's
// backfill runs (permissions are stored, not derived — §1 fact 2). D-8:
// `hotels:delete`/`users:delete` deleted as tokens — both routes are
// role-only (`requireRole('admin')`), no route ever checked them. D-9:
// `hotel_groups:read`/`hotel_groups:write` split out of `hotels:write` (one
// token no longer guards two differently-owned capabilities). D-4: MANAGER
// gains `users:write` (profile-only — see users/types.ts D-4a DTO split;
// role assignment stays a separate, Admin-only endpoint regardless of this
// token). REGIONAL_MANAGER previously had no entry here at all — a real
// latent bug (createUser/updateUserRole's `ROLE_PERMISSIONS[role] ?? ...`
// would have silently fallen back to WORKER's permission set for any
// REGIONAL_MANAGER row) — fixed here as MANAGER's set plus `hotel_groups:read`
// (D-5: RM sees its own group; no MASTER-data token, per D-2/D-3).
// ADR-030 D-5: Regional Manager holds Hotel Manager's full operational
// capability set at group scope — defined once here so REGIONAL_MANAGER below
// can build on it rather than drifting out of sync with a second copy. Frozen
// so a mutation like `ROLE_PERMISSIONS.MANAGER.push(...)` throws instead of
// silently granting REGIONAL_MANAGER the same token.
//
// REGIONAL_MANAGER is NO LONGER a bare alias of this array: per ADR-060 it also
// holds `org_chart:read` (C-33 — org chart is RM + Admin only, Manager `✗`),
// so it is spelled `[...MANAGER_PERMISSIONS, 'org_chart:read']` below — exactly
// the extension shape this comment previously prescribed for that case.
const MANAGER_PERMISSIONS = Object.freeze([
  'hotels:read',
  // ADR-030 §3 C-04 (Operate hotel — class O, e.g. the GD-05 pause toggle).
  // Distinct from `hotels:write`, which stays Admin-only MASTER data (C-01/C-02,
  // D-3): operating a hotel one already manages is not editing the hotel
  // record. No route consumes this token yet — C-04's own surface (the pause
  // toggle) is not built — so it is granted here to match the ratified matrix
  // rather than left absent; `permission-token-known-debt.ts` records it as
  // orphaned until that route exists.
  'hotels:operate',
  // C-08: a manager may view (only) the hotel group their own hotel
  // belongs to — enforced by scope filtering in-service (ADR-030 PR-4),
  // not by this token, which merely gates the route.
  'hotel_groups:read',
  'rooms:read', 'rooms:write',
  'tasks:read', 'tasks:write',
  'quality:read',
  'hr:read', 'hr:write',
  'staffing:read', 'staffing:write',
  'notifications:read',
  'analytics:read',
  'users:read',
  // ADR-030 D-4: profile-only — the DTO/route split (D-4a) means this
  // token never reaches User.role; see users/types.ts.
  'users:write',
  // Epic 5 PR 5.6 (SPEC-EMP-001): permission matrix — Hotel/Regional
  // Manager may view/blocklist within scope; creation stays Admin-only
  // (enforced service-side, OD-EMP-08).
  'employees:read', 'employees:write',
]) as string[];

// ADR-031 D-1 (PR-3): ROLE_PERMISSIONS is now consulted on the request path
// (backend-auth's authMiddleware), not only at write time — a frozen
// module-boundary contract, not an internal constant. MANAGER_PERMISSIONS was
// already Object.freeze'd (see above); ADMIN/CHECKER/WORKER's array literals
// and the outer map itself were not, a residual shallow-freeze gap flagged by
// independent review of this ADR. Hardened here: every array is frozen
// individually (all elements are string primitives, so a shallow freeze is
// a complete freeze — there is no nested mutable structure to deep-freeze),
// and the outer object is frozen last so no key can be added, removed, or
// reassigned to a different array either.
export const ROLE_PERMISSIONS: Record<string, string[]> = Object.freeze({
  ADMIN: Object.freeze([
    'admin:*',
    'users:read', 'users:write',
    'hotels:read', 'hotels:write',
    // ADR-030 §3 C-04 — see MANAGER_PERMISSIONS' note on this token.
    'hotels:operate',
    'hotel_groups:read', 'hotel_groups:write',
    'rooms:read', 'rooms:write',
    'tasks:read', 'tasks:write',
    'quality:read', 'quality:write',
    'hr:read', 'hr:write',
    'staffing:read', 'staffing:write',
    'notifications:read', 'notifications:write',
    'analytics:read',
    'audit:read',
    // Epic 5 PR 5.6 (SPEC-EMP-001): employee-management permissions.
    'employees:read', 'employees:write', 'employees:delete', 'employees:special_category:read',
  ]) as string[],
  MANAGER: MANAGER_PERMISSIONS,
  // ADR-060 / ADR-030 §3 C-33: RM = Manager's operational set plus
  // `org_chart:read`. This is the ONE capability where RM legitimately diverges
  // from Manager (CRR §1:23 — the org chart is visible ONLY to Regional Manager
  // and Admin), so it must not be folded back into MANAGER_PERMISSIONS.
  REGIONAL_MANAGER: Object.freeze([...MANAGER_PERMISSIONS, 'org_chart:read']) as string[],
  CHECKER: Object.freeze([
    'hotels:read',
    'rooms:read',
    'tasks:read',
    'quality:read', 'quality:write',
    'notifications:read',
    // Epic 5 PR 5.6 (SPEC-EMP-001): Checker views a worker's profile at their
    // assigned hotel (permission matrix), read-only.
    'employees:read',
    // A checker onboards exactly as a worker does -- uploads their own
    // documents, reads their own contract, requests their own payslip. These
    // mirror WORKER's self-scoped HR tokens below and carry the same guarantee:
    // worker_id is server-derived from the authenticated caller, never
    // client-supplied, so a checker can only ever reach their own records
    // (enforced in hr/service.ts and documents/service.ts, and verified by the
    // cross-worker 403 these routes return).
    'hr:contract:read-own',
    'hr:payslip:read-own',
    'hr:payslip:request',
  ]) as string[],
  WORKER: Object.freeze([
    'hotels:read',
    'rooms:read',
    'tasks:read',
    'notifications:read',
    // Read-only, and narrower than it looks: the only routes this token gates
    // are the two quality leaderboards, and getLeaderboard() confines a worker
    // to their own hotel group server-side. Rating and verification WRITES are
    // gated by quality:write, which a worker does not hold.
    'quality:read',
    // Epic 5 PR 5.6 (SPEC-EMP-001): a worker may view their own profile & history (self only).
    'employees:read',
    // ADR-042 (GD-15, OD-HR-10, 2026-07-28): two narrow, self-scoped HR
    // tokens -- NOT a blanket hr:read/hr:write extension. worker_id is
    // always server-derived from the authenticated caller for WORKER-role
    // callers, never client-supplied (FIND-SEC-HR-03 IDOR guard, satisfied
    // by construction). hr:contract:read-own is enforced on
    // GET /hr/workers/:worker_id/contract-status via
    // requireContractReadAccess() in hr/routes.ts; hr:payslip:request is
    // enforced on POST /hr/payslip-requests (HR implementation PR 4).
    'hr:contract:read-own',
    'hr:payslip:request',
    // ADR-042 (GD-15, OD-HR-10, 2026-08-04): narrow self-read token for
    // GET /hr/payroll when called by a worker. Worker sees only their own
    // PayslipRequest records — enforced in hrService.listPayroll via the same
    // actorId-override IDOR guard getContractStatus already uses (FIND-SEC-HR-03).
    // hr:read (held by admin/manager) is the broader token for the same route;
    // requirePayslipReadAccess() in hr/routes.ts enforces the role-specific split.
    'hr:payslip:read-own',
  ]) as string[],
});

export const BCRYPT_ROUNDS = 12;

// HOTFIX-AUTH-002: password-reset tokens are single-use and expire quickly to
// bound the window an intercepted/leaked token remains exploitable.
export const PASSWORD_RESET_TOKEN_TTL_MINUTES = 30;

/**
 * Cancellation reasons written when marking an absence auto-cancels that day's
 * shift. They distinguish a worker standing themselves down from a manager
 * standing them down, which the leaderboard depends on: only the worker-
 * initiated form is counted as a worker-declared absence.
 *
 * They live here, in a module that imports nothing, because both the writer
 * (calendar) and the reader (quality) need them. Importing calendar from
 * quality would close a calendar -> assignments -> quality import cycle.
 */
export const ABSENCE_CANCEL_REASON_SELF = 'Worker marked sick/vacation';
export const ABSENCE_CANCEL_REASON_MANAGER = 'Marked sick/vacation by a manager';
