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
    new_values?: Record<string, unknown>
  ) {
    const normalizedRole = actor_role
      ? (actor_role.toUpperCase() as UserRole)
      : null;
    await this.prisma.auditLog.create({
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
