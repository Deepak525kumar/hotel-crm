import { Prisma } from '@prisma/client';
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
    ip_address?: string
  ) {
    await this.prisma.auditLog.create({
      data: {
        actor_id,
        actor_role,
        action,
        resource_type,
        resource_id,
        details: details ? (details as Prisma.InputJsonValue) : Prisma.JsonNull,
        ip_address: ip_address || null,
        timestamp: new Date(),
      },
    });
  }
}
