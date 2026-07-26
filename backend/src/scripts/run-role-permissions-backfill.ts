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
 *
 * Deployment sequence (production rollout of this PR):
 *   1. Deploy this PR with FEATURE_GD02_MATRIX unset/false — route gates,
 *      schemas, and ROLE_PERMISSIONS all ship, but nothing changes for any
 *      existing account or route yet ("both-off = current behavior").
 *   2. Set FEATURE_GD02_MATRIX=true.
 *   3. Run this script exactly once (`npm run role-permissions:backfill`)
 *      against production. It is idempotent — a second run is a safe no-op
 *      for any row already backfilled.
 *   4. Verify: spot-check a MANAGER/REGIONAL_MANAGER account's `permissions`
 *      column matches ROLE_PERMISSIONS, and confirm the new AuditLog
 *      `BACKFILL_PERMISSIONS` rows look correct.
 *   5. Leave the flag enabled. Do NOT disable FEATURE_GD02_MATRIX after this
 *      point as an incident rollback — the backfill is a DB write the flag
 *      cannot undo, and POST /users' Admin-only role gate is deliberately
 *      NOT tied to this flag for exactly that reason (security review
 *      SEC-01, ADR-030 PR-5). If a real rollback is needed, it requires
 *      re-running an inverse data migration, not just flipping the flag.
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
