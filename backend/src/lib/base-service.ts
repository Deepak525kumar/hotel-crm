import { Prisma, UserRole } from '@prisma/client';
import { getPrisma } from './db.js';

export class BaseService {
  protected prisma = getPrisma();

  async logAudit(
    actor_id: string | null,
    actor_role: string | null,
    action: string,
    resource_type: string,
    resource_id: string,
    details?: Record<string, unknown>,
    ip_address?: string,
    old_values?: Record<string, unknown>,
    new_values?: Record<string, unknown>,
    tx?: Prisma.TransactionClient
  ) {
    // 2026-08-13 fix: this blind-uppercased whatever string it was handed and
    // asserted it into UserRole. Two callers pass 'system' for an actor that
    // is a scheduled job, not a person -- 'SYSTEM' is not a UserRole member,
    // so Prisma rejected the write with "Invalid value for argument
    // `actor_role`". Both callers log INSIDE a transaction, so the throw rolled
    // the whole transaction back: closeExpiredBroadcasts() never actually
    // closed a single broadcast (they stayed OPEN forever, the reported
    // "work request still says pending"), and the contract-lapse deactivation
    // sweep never deactivated anyone. Neither failure was visible in tests,
    // which mock auditLog.create and so accept any string.
    //
    // A non-person actor is now recorded as actor_role: null -- the column is
    // already nullable and already means "no user role applies here" (actor_id
    // is null for these too). The acting job stays identifiable through
    // `action` (AUTO_CLOSE, employee.deactivate.contract_lapse).
    const upper = actor_role?.toUpperCase();
    const normalizedRole =
      upper && (Object.values(UserRole) as string[]).includes(upper)
        ? (upper as UserRole)
        : null;
    const client = tx || this.prisma;
    await client.auditLog.create({
      data: {
        actor_id,
        actor_role: normalizedRole,
        action,
        resource_type,
        resource_id,
        details: details ? (details as Prisma.InputJsonValue) : Prisma.JsonNull,
        old_values: old_values ? (old_values as Prisma.InputJsonValue) : Prisma.JsonNull,
        new_values: new_values ? (new_values as Prisma.InputJsonValue) : Prisma.JsonNull,
        ip_address: ip_address || null,
        timestamp: new Date(),
      },
    });
  }
}
