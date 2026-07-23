import { Prisma, PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

// ADR-029 (2026-07-23, GD-01): alias so callers depend on a repository-owned
// name rather than importing `Prisma.TransactionClient` directly at every call
// site — Prisma stays an implementation detail of this module, not something
// that leaks through every service's transaction-accepting method signature.
export type DatabaseTransaction = Prisma.TransactionClient;

let prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }

  return prisma;
}

/**
 * Establish and verify database connectivity before the server begins
 * accepting traffic. Unlike getPrisma(), this awaits $connect() so the
 * caller can fail fast at startup when the database is unavailable instead
 * of the server listening on a half-ready connection.
 */
export async function connectDb(): Promise<void> {
  const client = getPrisma();
  await client.$connect();
  logger.info('Connected to database');
}

export async function disconnectDb(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    logger.info('Disconnected from database');
  }
}
