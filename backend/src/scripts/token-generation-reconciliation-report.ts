/**
 * ADR-031 §3 D-1 / §4 C-2 / §6 M-2 — read-only reconciliation report.
 *
 * Deliberately NOT a migration and NOT a write: the point of ADR-031 is to
 * stop reconciling snapshots, not to run one more backfill. This script only
 * reports, for every ADMIN/MANAGER/REGIONAL_MANAGER/CHECKER/WORKER row,
 * whether the stored `User.permissions` snapshot still matches
 * `ROLE_PERMISSIONS[role]` — the same drift ADR-030's M-2 backfill was meant
 * to close, now checked one more time before FEATURE_DERIVED_PERMISSIONS is
 * ever flipped on.
 *
 * Why this matters (C-2): once derivation is live, any row where
 * `permissions !== ROLE_PERMISSIONS[role]` is a LIVE AUTHORIZATION CHANGE
 * the moment the flag flips — a drifted row that *loses* a permission is an
 * availability incident, one that *gains* a permission is a security
 * incident. Neither may be discovered in production. This report's output is
 * the Security-Review evidence PR-3 ships with (ADR-031 §7 PR-3); reviewing
 * it, not running it, is the gate.
 */
import { PrismaClient } from '@prisma/client';
import { ROLE_PERMISSIONS } from '../config/constants.js';

export interface DriftedRow {
  user_id: string;
  role: string;
  stored_permissions: string[];
  role_permissions: string[];
  direction: 'loses_permissions' | 'gains_permissions' | 'differs';
}

export interface TokenGenerationReconciliationReport {
  total_rows: number;
  drifted_count: number;
  drifted_by_role: Record<string, number>;
  sample: DriftedRow[];
}

function diffDirection(stored: string[], target: string[]): DriftedRow['direction'] {
  const storedSet = new Set(stored);
  const targetSet = new Set(target);
  const loses = [...storedSet].some((p) => !targetSet.has(p));
  const gains = [...targetSet].some((p) => !storedSet.has(p));
  if (gains && !loses) return 'gains_permissions';
  if (loses && !gains) return 'loses_permissions';
  return 'differs';
}

function permissionsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((perm, i) => perm === sortedB[i]);
}

const SAMPLE_LIMIT = 25;

export async function buildTokenGenerationReconciliationReport(
  prisma: Pick<PrismaClient, 'user'>
): Promise<TokenGenerationReconciliationReport> {
  const users = await prisma.user.findMany({
    where: { deleted_at: null },
    select: { id: true, role: true, permissions: true },
  });

  const drifted: DriftedRow[] = [];
  const drifted_by_role: Record<string, number> = {};

  for (const user of users) {
    const target = ROLE_PERMISSIONS[user.role] ?? [];
    if (permissionsEqual(user.permissions, target)) continue;

    drifted_by_role[user.role] = (drifted_by_role[user.role] ?? 0) + 1;
    drifted.push({
      user_id: user.id,
      role: user.role,
      stored_permissions: user.permissions,
      role_permissions: target,
      direction: diffDirection(user.permissions, target),
    });
  }

  return {
    total_rows: users.length,
    drifted_count: drifted.length,
    drifted_by_role,
    sample: drifted.slice(0, SAMPLE_LIMIT),
  };
}
