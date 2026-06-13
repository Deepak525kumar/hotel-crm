import { getPrisma } from './db.js';
import { Prisma } from '@prisma/client';

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
        actor_role: actor_role as any,
        action,
        resource_type,
        resource_id,
        details: (details ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        ip_address: ip_address || null,
        timestamp: new Date(),
      },
    });
  }
}
