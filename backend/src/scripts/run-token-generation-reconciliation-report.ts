#!/usr/bin/env tsx
/**
 * CLI entrypoint for ADR-031 §4 C-2 / §6 M-2. See
 * token-generation-reconciliation-report.ts for the rationale.
 *
 * Unlike run-role-permissions-backfill.ts (ADR-030), this script is meant to
 * run BEFORE FEATURE_DERIVED_PERMISSIONS is flipped on, as the Security
 * Review evidence C-2 requires — it does not refuse to run based on the
 * flag's current state, and it never writes anything.
 *
 * Usage: DATABASE_URL=... npm run token-generation:reconciliation-report
 *
 * Deployment sequence (before enabling FEATURE_DERIVED_PERMISSIONS):
 *   1. Run this script against the target environment's database.
 *   2. If drifted_count is 0: no live authorization change occurs when the
 *      flag flips. Proceed.
 *   3. If drifted_count > 0: review every sample row's `direction`.
 *      `gains_permissions` rows are a security-incident-class change (the
 *      account gains a token it does not have today) and must be resolved
 *      (either accept the ROLE_PERMISSIONS grant as intended, or investigate
 *      why the stored snapshot never had it). `loses_permissions` rows are
 *      an availability-incident-class change (the account loses a token it
 *      currently uses) and must be investigated before the flag flips, not
 *      discovered afterward as a support ticket.
 *   4. Attach this run's output (or the sample) to the Security Review that
 *      authorizes flipping FEATURE_DERIVED_PERMISSIONS — this is exactly
 *      what C-2 requires as blocking evidence, and PR-3 does not authorize
 *      the flip on its own.
 */
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '../config/env.js';
import { buildTokenGenerationReconciliationReport } from './token-generation-reconciliation-report.js';

async function main() {
  loadEnv();

  const prisma = new PrismaClient();
  try {
    const report = await buildTokenGenerationReconciliationReport(prisma);
    console.log(
      `[token-generation-reconciliation-report] ${report.drifted_count} of ${report.total_rows} row(s) drifted from ROLE_PERMISSIONS.`
    );
    if (report.drifted_count === 0) {
      console.log('[token-generation-reconciliation-report] No drift — safe to enable FEATURE_DERIVED_PERMISSIONS.');
      return;
    }

    console.log('[token-generation-reconciliation-report] Drifted rows by role:');
    for (const [role, count] of Object.entries(report.drifted_by_role)) {
      console.log(`  - ${role}: ${count}`);
    }

    console.log(`[token-generation-reconciliation-report] Sample (up to ${report.sample.length} of ${report.drifted_count}):`);
    for (const row of report.sample) {
      console.log(`  - user_id=${row.user_id} role=${row.role} direction=${row.direction}`);
    }

    console.log(
      '[token-generation-reconciliation-report] Attach this output to the Security Review before enabling FEATURE_DERIVED_PERMISSIONS (ADR-031 C-2).'
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[token-generation-reconciliation-report] ERROR:', err);
  process.exitCode = 1;
});
