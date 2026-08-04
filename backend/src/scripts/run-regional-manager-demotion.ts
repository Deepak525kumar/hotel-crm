#!/usr/bin/env tsx
/**
 * CLI entrypoint for regional-manager-demotion.ts. See that file for
 * rationale, idempotency, and Decision 11's live guard.
 *
 * Unlike run-regional-manager-promotion.ts, this does NOT gate on
 * FEATURE_RM_ROLE: that flag governs the M-3 promotion-rollout ordering
 * (ADR-030 §6), not RM behavior generally (see the PR #338 audit — no
 * request-path code reads it). Demotion is an independent operator action;
 * it only ever touches REGIONAL_MANAGER users who already own zero hotel
 * groups, which is safe regardless of the flag's state.
 *
 * Usage: DATABASE_URL=... npm run rm-role:demote
 */
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '../config/env.js';
import { demoteRegionalManagers } from './regional-manager-demotion.js';

async function main() {
  loadEnv();

  const prisma = new PrismaClient();
  try {
    const result = await demoteRegionalManagers(prisma);
    console.log(
      `[regional-manager-demotion] Demoted ${result.demoted.length} user(s) REGIONAL_MANAGER -> MANAGER.`
    );
    for (const userId of result.demoted) {
      console.log(`  - user_id=${userId}`);
    }
    console.log(
      `[regional-manager-demotion] Skipped ${result.skippedStillOwnsGroup} row(s) still owning a hotel group (Decision 11 — transfer first).`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[regional-manager-demotion] ERROR:', err);
  process.exitCode = 1;
});
