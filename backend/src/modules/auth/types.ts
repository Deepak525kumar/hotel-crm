import { z } from 'zod';

// ADR-016: backend-auth is the authoritative writer of AuditLog and the
// owner of any read interface over it. This query/DTO pair is intentionally
// generic -- no field, name, or comment here is shaped around any specific
// caller (e.g. backend-compliance). ADR-016 itself anticipated "a future
// IF-AUTH-*/IF-AUDIT-* contract", not a caller-specific one; any future
// in-process consumer (Compliance, a later Analytics/Reporting need, etc.)
// imports and calls this the same way. Bounded/paginated, mirroring
// ConsentService.getAuditHistory's and RetentionService.getDeletionAuditLog's
// identical guardrail for their own equivalent audit-read interfaces.
export const AuditLogQuerySchema = z.object({
  actor_id: z.string().min(1).optional(),
  // Free string, not z.nativeEnum(UserRole): an invalid role value simply
  // matches zero rows (service.ts normalizes it uppercase before querying),
  // never a validation error. Acceptable today -- if this schema is ever
  // tightened to reject unknown values up front, switch to
  // z.nativeEnum(UserRole) then, not before it's actually needed.
  actor_role: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  resource_type: z.string().min(1).optional(),
  resource_id: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

// Shaped directly off the AuditLog model's own fields (schema.prisma:979-1001)
// -- no field renamed or reinterpreted for any particular reader.
export interface AuditLogEntryDto {
  id: string;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  old_values: unknown;
  new_values: unknown;
  details: unknown;
  ip_address: string | null;
  timestamp: string;
}

export interface AuthUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
  profile_photo_url?: string;
  role: string;
  permissions: string[];
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export type AuthResponse = AuthTokens & { user: AuthUser };
