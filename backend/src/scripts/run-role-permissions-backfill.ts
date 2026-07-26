#!/usr/bin/env tsx
/**
 * CLI entrypoint for ADR-030 M-2 (§6 PR-5). See role-permissions-backfill.ts
 * for the rationale, idempotency, and snapshot mechanism.
 *
 * Refuses to run unless FEATURE_GD02_MATRIX=true — running it while off
 * would grant every existing admin/manager the new permission tokens before
 * the route gates are prepared to enforce them narrowly.
 *
 * Usage: FEATURE_GD02_MATRIX=true DATABASE_URL=... npm run role-permissions:backfill
 */
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '../config/env.js';
import { isGD02MatrixEnabled } from '../config/feature-flags.js';
import { backfillRolePermissions } from './role-permissions-backfill.js';

async function main() {
  loadEnv();

  if (!isGD02MatrixEnabled()) {
    console.log(
      '[role-permissions-backfill] FEATURE_GD02_MATRIX is disabled — refusing to run (ADR-030 §6 M-2 is only meaningful once the flag is on). No-op.'
    );
    return;
  }

  const prisma = new PrismaClient();
  try {
    const result = await backfillRolePermissions(prisma);
    console.log(
      `[role-permissions-backfill] Updated ${result.updated.length} of ${result.total} ADMIN/MANAGER/REGIONAL_MANAGER row(s).`
    );
    for (const u of result.updated) {
      console.log(`  - user_id=${u.user_id} (role=${u.role})`);
    }
    console.log(`[role-permissions-backfill] ${result.unchanged} row(s) already matched (idempotent, no-op).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[role-permissions-backfill] ERROR:', err);
  process.exitCode = 1;
});
