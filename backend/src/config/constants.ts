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
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: [
    'admin:*',
    'users:read', 'users:write', 'users:delete',
    'hotels:read', 'hotels:write', 'hotels:delete',
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
  ],
  MANAGER: [
    'hotels:read',
    'rooms:read', 'rooms:write',
    'tasks:read', 'tasks:write',
    'quality:read',
    'hr:read', 'hr:write',
    'staffing:read', 'staffing:write',
    'notifications:read',
    'analytics:read',
    'users:read',
    // Epic 5 PR 5.6 (SPEC-EMP-001): permission matrix — Hotel/Regional
    // Manager may view/blocklist within scope; creation stays Admin-only
    // (enforced service-side, OD-EMP-08).
    'employees:read', 'employees:write',
  ],
  CHECKER: [
    'hotels:read',
    'rooms:read',
    'tasks:read',
    'quality:read', 'quality:write',
    'notifications:read',
    // Epic 5 PR 5.6 (SPEC-EMP-001): Checker views a worker's profile at their
    // assigned hotel (permission matrix), read-only.
    'employees:read',
  ],
  WORKER: [
    'hotels:read',
    'rooms:read',
    'tasks:read',
    'notifications:read',
    // Epic 5 PR 5.6 (SPEC-EMP-001): a worker may view their own profile & history (self only).
    'employees:read',
  ],
};

export const BCRYPT_ROUNDS = 12;

// HOTFIX-AUTH-002: password-reset tokens are single-use and expire quickly to
// bound the window an intercepted/leaked token remains exploitable.
export const PASSWORD_RESET_TOKEN_TTL_MINUTES = 30;
