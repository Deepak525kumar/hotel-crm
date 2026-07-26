#!/usr/bin/env tsx
/**
 * CLI entrypoint for ADR-030 M-3 (§6 PR-2). See regional-manager-promotion.ts
 * for the rationale, idempotency, and snapshot mechanism.
 *
 * Refuses to run unless FEATURE_RM_ROLE=true (D-6/§6 ordering constraint):
 * this promotion must not happen in production before PR-3 ships.
 *
 * Usage: FEATURE_RM_ROLE=true DATABASE_URL=... npm run rm-role:promote
 */
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '../config/env.js';
import { isRmRoleEnabled } from '../config/feature-flags.js';
import { promoteRegionalManagers } from './regional-manager-promotion.js';

async function main() {
  loadEnv();

  if (!isRmRoleEnabled()) {
    console.log(
      '[regional-manager-promotion] FEATURE_RM_ROLE is disabled — refusing to run (ADR-030 §6 ordering constraint: PR-3 must ship first). No-op.'
    );
    return;
  }

  const prisma = new PrismaClient();
  try {
    const result = await promoteRegionalManagers(prisma);
    console.log(
      `[regional-manager-promotion] Promoted ${result.promoted.length} user(s) MANAGER -> REGIONAL_MANAGER.`
    );
    for (const p of result.promoted) {
      console.log(`  - user_id=${p.user_id} (hotel_group_id=${p.hotel_group_id})`);
    }
    console.log(
      `[regional-manager-promotion] Skipped ${result.skippedAlreadyPromoted} row(s) already non-MANAGER (idempotent).`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[regional-manager-promotion] ERROR:', err);
  process.exitCode = 1;
});
