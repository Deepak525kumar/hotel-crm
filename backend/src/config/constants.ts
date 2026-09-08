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
    // Self-scoped WRITE tokens (2026-09-04, owner decision). Held by EVERY
    // role, deliberately: `POST /calendar/my-absences` and
    // `POST /notifications/:id/read` are open to any authenticated user and
    // must stay that way, so these are "satisfied by construction" exactly as
    // ADR-042/OD-HR-10 describes `hr:contract:read-own`. They do not exist to
    // deny anyone.
    //
    // They exist so the capability is NAMEABLE. Both routes previously
    // enforced no token at all, with the owning service's ownership check as
    // the whole gate. That is sound for HTTP, but it left the two safest
    // writes on the platform -- a person marking their own message read, or
    // declaring their own sick day -- impossible to expose as chatbot tools,
    // because the tool registry requires every non-READ_ONLY tool to declare
    // a real permission and rightly refuses the `null` escape hatch for
    // writes. Naming the capability is the honest fix; loosening that guard
    // was the alternative and was rejected.
    'calendar:absence:write-own',
    'notifications:mark-read-own',
    // Changing an assignment's STATUS (start, complete, cancel), added
    // 2026-09-08. PATCH /assignments/:id carries no requireRole and no token:
    // the service is the whole gate, refusing a self-scoped caller any
    // assignment that is not theirs, applying its own eligibility rules to
    // IN_PROGRESS/COMPLETED, and admitting a scoped manager only within scope.
    //
    // Deliberately NOT named `-own`, unlike the two tokens above: the same
    // route is how a MANAGER cancels somebody else's assignment, so an
    // "-own" name would misdescribe what it gates. Whose assignment a caller
    // may touch is the service's decision, not this token's; the token names
    // the capability, and every role holds it because the route admits every
    // role. It denies nobody -- it makes the capability nameable.
    'assignments:status-write',
    // Accepting an open shift broadcast for yourself, added 2026-09-09.
    // POST /job-requests/broadcasts/:id/accept carries no requireRole -- it is
    // a worker-initiated action and the service enforces role targeting,
    // roster eligibility, skill match and daily exclusivity itself. Held by
    // every role because the route admits every role; it denies nobody and
    // exists so the capability is nameable, exactly like
    // `calendar:absence:write-own`.
    'job_requests:accept-own',
    // Reporting and export over arbitrary date ranges, added 2026-09-08.
    // Manager/RM/admin only: a team report contains other people's hours,
    // absences and names, so it is a management capability and gated like one.
    'reports:read-team',
    'reports:export-team',
    // Exporting YOUR OWN data as a spreadsheet, added 2026-09-08. Held by
    // EVERY role including worker and checker, and it denies nobody -- this is
    // the GDPR Article 15/20 right of access and portability, which the
    // platform already honours as JSON via Compliance's subject-rights bundle.
    // Gating it by role would be gating a legal right, so the token exists to
    // NAME the capability (and let a chatbot tool declare it), never to
    // withhold it.
    'reports:export-own',
    // The manager-on-a-worker's-behalf counterpart, added 2026-09-07 for the
    // same reason and by the same argument as the two above: naming the
    // capability rather than loosening the registry.
    //
    // `POST /calendar/absences` gated on requireRole(admin|manager|
    // regional_manager) and NO token, so no honest `permission` existed for a
    // chatbot tool to declare -- and `null` is not available to a
    // HIGH_RISK_WRITE, correctly. Borrowing `staffing:write` (which happens to
    // match the same three roles) was the alternative and was rejected: it is
    // not a calendar token, and declaring a token the route does not check is
    // the documented trap in CHATBOT_HANDOFF section 6.
    //
    // Granted to exactly the roles the route already admits -- MANAGER (RM
    // inherits this list) and ADMIN, never WORKER or CHECKER -- and the route
    // now enforces it too (calendar/routes.ts), so this is a no-op for HTTP
    // callers and the declaration is true rather than merely convenient.
    'calendar:absence:write-team',
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
    // Self-scoped WRITE tokens (2026-09-04, owner decision). Held by EVERY
    // role, deliberately: `POST /calendar/my-absences` and
    // `POST /notifications/:id/read` are open to any authenticated user and
    // must stay that way, so these are "satisfied by construction" exactly as
    // ADR-042/OD-HR-10 describes `hr:contract:read-own`. They do not exist to
    // deny anyone.
    //
    // They exist so the capability is NAMEABLE. Both routes previously
    // enforced no token at all, with the owning service's ownership check as
    // the whole gate. That is sound for HTTP, but it left the two safest
    // writes on the platform -- a person marking their own message read, or
    // declaring their own sick day -- impossible to expose as chatbot tools,
    // because the tool registry requires every non-READ_ONLY tool to declare
    // a real permission and rightly refuses the `null` escape hatch for
    // writes. Naming the capability is the honest fix; loosening that guard
    // was the alternative and was rejected.
    'calendar:absence:write-own',
    'notifications:mark-read-own',
    // Changing an assignment's STATUS (start, complete, cancel), added
    // 2026-09-08. PATCH /assignments/:id carries no requireRole and no token:
    // the service is the whole gate, refusing a self-scoped caller any
    // assignment that is not theirs, applying its own eligibility rules to
    // IN_PROGRESS/COMPLETED, and admitting a scoped manager only within scope.
    //
    // Deliberately NOT named `-own`, unlike the two tokens above: the same
    // route is how a MANAGER cancels somebody else's assignment, so an
    // "-own" name would misdescribe what it gates. Whose assignment a caller
    // may touch is the service's decision, not this token's; the token names
    // the capability, and every role holds it because the route admits every
    // role. It denies nobody -- it makes the capability nameable.
    'assignments:status-write',
    // Accepting an open shift broadcast for yourself, added 2026-09-09.
    // POST /job-requests/broadcasts/:id/accept carries no requireRole -- it is
    // a worker-initiated action and the service enforces role targeting,
    // roster eligibility, skill match and daily exclusivity itself. Held by
    // every role because the route admits every role; it denies nobody and
    // exists so the capability is nameable, exactly like
    // `calendar:absence:write-own`.
    'job_requests:accept-own',
    // Reporting and export over arbitrary date ranges, added 2026-09-08.
    // Manager/RM/admin only: a team report contains other people's hours,
    // absences and names, so it is a management capability and gated like one.
    'reports:read-team',
    'reports:export-team',
    // Exporting YOUR OWN data as a spreadsheet, added 2026-09-08. Held by
    // EVERY role including worker and checker, and it denies nobody -- this is
    // the GDPR Article 15/20 right of access and portability, which the
    // platform already honours as JSON via Compliance's subject-rights bundle.
    // Gating it by role would be gating a legal right, so the token exists to
    // NAME the capability (and let a chatbot tool declare it), never to
    // withhold it.
    'reports:export-own',
    // The manager-on-a-worker's-behalf counterpart, added 2026-09-07 for the
    // same reason and by the same argument as the two above: naming the
    // capability rather than loosening the registry.
    //
    // `POST /calendar/absences` gated on requireRole(admin|manager|
    // regional_manager) and NO token, so no honest `permission` existed for a
    // chatbot tool to declare -- and `null` is not available to a
    // HIGH_RISK_WRITE, correctly. Borrowing `staffing:write` (which happens to
    // match the same three roles) was the alternative and was rejected: it is
    // not a calendar token, and declaring a token the route does not check is
    // the documented trap in CHATBOT_HANDOFF section 6.
    //
    // Granted to exactly the roles the route already admits -- MANAGER (RM
    // inherits this list) and ADMIN, never WORKER or CHECKER -- and the route
    // now enforces it too (calendar/routes.ts), so this is a no-op for HTTP
    // callers and the declaration is true rather than merely convenient.
    'calendar:absence:write-team',
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
    // Self-scoped WRITE tokens (2026-09-04, owner decision). Held by EVERY
    // role, deliberately: `POST /calendar/my-absences` and
    // `POST /notifications/:id/read` are open to any authenticated user and
    // must stay that way, so these are "satisfied by construction" exactly as
    // ADR-042/OD-HR-10 describes `hr:contract:read-own`. They do not exist to
    // deny anyone.
    //
    // They exist so the capability is NAMEABLE. Both routes previously
    // enforced no token at all, with the owning service's ownership check as
    // the whole gate. That is sound for HTTP, but it left the two safest
    // writes on the platform -- a person marking their own message read, or
    // declaring their own sick day -- impossible to expose as chatbot tools,
    // because the tool registry requires every non-READ_ONLY tool to declare
    // a real permission and rightly refuses the `null` escape hatch for
    // writes. Naming the capability is the honest fix; loosening that guard
    // was the alternative and was rejected.
    'calendar:absence:write-own',
    'notifications:mark-read-own',
    // Clocking in and out of your OWN shift, added 2026-09-08. Both routes
    // enforced no token at all -- POST /attendance gated on
    // requireRole(worker|checker) and PATCH /attendance/:id on nothing --
    // and checkIn() refuses any assignment whose worker_id is not the caller,
    // which is the real boundary either way.
    //
    // Named for the same reason as `calendar:absence:write-own`: a write tool
    // may not use the registry's `null` escape hatch, so an unnamed capability
    // is one the assistant cannot offer at all. Granted to WORKER and CHECKER
    // only, matching requireRole on the check-in route -- a manager does not
    // clock in.
    'attendance:write-own',
    // Changing an assignment's STATUS (start, complete, cancel), added
    // 2026-09-08. PATCH /assignments/:id carries no requireRole and no token:
    // the service is the whole gate, refusing a self-scoped caller any
    // assignment that is not theirs, applying its own eligibility rules to
    // IN_PROGRESS/COMPLETED, and admitting a scoped manager only within scope.
    //
    // Deliberately NOT named `-own`, unlike the two tokens above: the same
    // route is how a MANAGER cancels somebody else's assignment, so an
    // "-own" name would misdescribe what it gates. Whose assignment a caller
    // may touch is the service's decision, not this token's; the token names
    // the capability, and every role holds it because the route admits every
    // role. It denies nobody -- it makes the capability nameable.
    'assignments:status-write',
    // Accepting an open shift broadcast for yourself, added 2026-09-09.
    // POST /job-requests/broadcasts/:id/accept carries no requireRole -- it is
    // a worker-initiated action and the service enforces role targeting,
    // roster eligibility, skill match and daily exclusivity itself. Held by
    // every role because the route admits every role; it denies nobody and
    // exists so the capability is nameable, exactly like
    // `calendar:absence:write-own`.
    'job_requests:accept-own',
    // Exporting YOUR OWN data as a spreadsheet, added 2026-09-08. Held by
    // EVERY role including worker and checker, and it denies nobody -- this is
    // the GDPR Article 15/20 right of access and portability, which the
    // platform already honours as JSON via Compliance's subject-rights bundle.
    // Gating it by role would be gating a legal right, so the token exists to
    // NAME the capability (and let a chatbot tool declare it), never to
    // withhold it.
    'reports:export-own',
  ]) as string[],
  WORKER: Object.freeze([
    'hotels:read',
    // `rooms:write` granted 2026-09-01: the worker logs the rooms they cleaned,
    // room by room (modules/rooms). Self-scoped by identity, not by this token
    // -- RoomService checks assignment.worker_id === caller on every write, so
    // the grant admits a worker to their OWN log and nothing else. Until this
    // feature both room tokens were dead (see __tests__/support/known-debt.ts).
    'rooms:read',
    'rooms:write',
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
    // Self-scoped WRITE tokens (2026-09-04, owner decision). Held by EVERY
    // role, deliberately: `POST /calendar/my-absences` and
    // `POST /notifications/:id/read` are open to any authenticated user and
    // must stay that way, so these are "satisfied by construction" exactly as
    // ADR-042/OD-HR-10 describes `hr:contract:read-own`. They do not exist to
    // deny anyone.
    //
    // They exist so the capability is NAMEABLE. Both routes previously
    // enforced no token at all, with the owning service's ownership check as
    // the whole gate. That is sound for HTTP, but it left the two safest
    // writes on the platform -- a person marking their own message read, or
    // declaring their own sick day -- impossible to expose as chatbot tools,
    // because the tool registry requires every non-READ_ONLY tool to declare
    // a real permission and rightly refuses the `null` escape hatch for
    // writes. Naming the capability is the honest fix; loosening that guard
    // was the alternative and was rejected.
    'calendar:absence:write-own',
    'notifications:mark-read-own',
    // Clocking in and out of your OWN shift, added 2026-09-08. Both routes
    // enforced no token at all -- POST /attendance gated on
    // requireRole(worker|checker) and PATCH /attendance/:id on nothing --
    // and checkIn() refuses any assignment whose worker_id is not the caller,
    // which is the real boundary either way.
    //
    // Named for the same reason as `calendar:absence:write-own`: a write tool
    // may not use the registry's `null` escape hatch, so an unnamed capability
    // is one the assistant cannot offer at all. Granted to WORKER and CHECKER
    // only, matching requireRole on the check-in route -- a manager does not
    // clock in.
    'attendance:write-own',
    // Changing an assignment's STATUS (start, complete, cancel), added
    // 2026-09-08. PATCH /assignments/:id carries no requireRole and no token:
    // the service is the whole gate, refusing a self-scoped caller any
    // assignment that is not theirs, applying its own eligibility rules to
    // IN_PROGRESS/COMPLETED, and admitting a scoped manager only within scope.
    //
    // Deliberately NOT named `-own`, unlike the two tokens above: the same
    // route is how a MANAGER cancels somebody else's assignment, so an
    // "-own" name would misdescribe what it gates. Whose assignment a caller
    // may touch is the service's decision, not this token's; the token names
    // the capability, and every role holds it because the route admits every
    // role. It denies nobody -- it makes the capability nameable.
    'assignments:status-write',
    // Accepting an open shift broadcast for yourself, added 2026-09-09.
    // POST /job-requests/broadcasts/:id/accept carries no requireRole -- it is
    // a worker-initiated action and the service enforces role targeting,
    // roster eligibility, skill match and daily exclusivity itself. Held by
    // every role because the route admits every role; it denies nobody and
    // exists so the capability is nameable, exactly like
    // `calendar:absence:write-own`.
    'job_requests:accept-own',
    // Exporting YOUR OWN data as a spreadsheet, added 2026-09-08. Held by
    // EVERY role including worker and checker, and it denies nobody -- this is
    // the GDPR Article 15/20 right of access and portability, which the
    // platform already honours as JSON via Compliance's subject-rights bundle.
    // Gating it by role would be gating a legal right, so the token exists to
    // NAME the capability (and let a chatbot tool declare it), never to
    // withhold it.
    'reports:export-own',
  ]) as string[],
});

// Stays at 12 deliberately, even after the 2026-09-03 switch from `bcryptjs`
// to native `bcrypt`. Lowering it (12 -> 10 would be ~4x faster) was
// considered and rejected: the capacity problem that prompted the switch was
// never raw hash cost, it was that `bcryptjs` is pure JavaScript and blocks
// the event loop, so every login stalled every other in-flight request.
// Native bcrypt runs on libuv's threadpool instead -- measured on the
// production host: per-hash cost is essentially unchanged (~300ms either
// way), but event-loop lag during a compare dropped from ~182ms to ~2ms.
// That fixes the concurrency problem without spending any of the offline-
// brute-force resistance that rounds actually buys.
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
