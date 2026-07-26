import { describe, it, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

// ADR-031 C-6/D-4 (PR-4): "No handler may read User.permissions after PR-4"
// and "no module other than backend-auth writes token_generation directly."
// Enforced here as a static grep over src/, in the spirit of ADR-030 D-8's
// invariant test (permission-token-hygiene.test.ts) — a future PR reaching
// for `.permissions` on a User row, or incrementing `token_generation`
// outside the designated seam, fails this test rather than silently
// reintroducing a second authority/writer.

const SRC_ROOT = path.join(__dirname, '..');

// The seam itself, and its own definition/tests, legitimately reference
// these symbols and must not trip the invariant.
const ALLOWED_TOKEN_GENERATION_WRITE_FILES = new Set([
  path.join(SRC_ROOT, 'modules/auth/service.ts'),
  path.join(SRC_ROOT, 'middleware/auth.ts'), // reads, does not write
]);

// User.permissions may still exist as a schema/select field through PR-6
// (dropped only at PR-7); these are the pre-existing sites that select it
// for backward-compatible response shapes but must not authorize from it.
// No new site may be added — this list is not meant to grow.
const ALLOWED_PERMISSIONS_SELECT_FILES = new Set([
  path.join(SRC_ROOT, 'modules/users/service.ts'),
  path.join(SRC_ROOT, 'modules/auth/service.ts'),
  path.join(SRC_ROOT, 'middleware/auth.ts'),
]);

// `scripts/` holds offline migration/reconciliation tools (ADR-030 M-2
// backfill, ADR-031 M-2 reconciliation report) whose entire job is to read
// and compare the stored `User.permissions` snapshot against
// ROLE_PERMISSIONS — that is data analysis, not request-path authorization,
// so it is out of scope for this invariant.
const EXCLUDED_DIRS = new Set(['__tests__', 'node_modules', 'scripts']);

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      files = files.concat(walk(full));
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('ADR-031 C-6: token_generation write-seam and permissions-read invariant', () => {
  const files = walk(SRC_ROOT);

  it('found source files to check (sanity check)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('token_generation is written only via bumpTokenGeneration/the auth-owned seam', () => {
    const offenders: string[] = [];
    // Covers object-literal writes (`token_generation: { increment: 1 }`,
    // `token_generation: 0`), bracket-key writes (`['token_generation']:`),
    // and raw SQL escapes ($executeRaw/$queryRaw referencing the column).
    const directWritePatterns = [
      /token_generation\s*:\s*\{?\s*(increment|set)/,
      /\[\s*['"`]token_generation['"`]\s*\]\s*:/,
      /\$(execute|query)Raw\w*[\s\S]{0,200}token_generation/,
    ];

    for (const file of files) {
      if (ALLOWED_TOKEN_GENERATION_WRITE_FILES.has(file)) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (directWritePatterns.some((p) => p.test(content))) {
        offenders.push(path.relative(SRC_ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it('no handler authorizes from a User.permissions read outside the allowed pre-PR-7 sites', () => {
    const offenders: string[] = [];
    // Matches a `.permissions` (or bracket-key `['permissions']`) read off
    // any of the common result-variable names this codebase's User read/
    // write paths bind to (user, updated, result, row, targetUser) — not
    // the derived req.auth.permissions (which requirePermission/requireRole
    // legitimately keep reading per D-7), and not prose mentions like
    // "User.permissions" in a comment (no trailing property-access syntax).
    const boundVariableNames = ['user', 'updated', 'result', 'row', 'targetUser'];
    const permissionsFieldPatterns = boundVariableNames.map(
      (name) => new RegExp(`\\b${name}(\\.permissions\\b|\\[['"\`]permissions['"\`]\\])`)
    );

    for (const file of files) {
      if (ALLOWED_PERMISSIONS_SELECT_FILES.has(file)) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (permissionsFieldPatterns.some((p) => p.test(content))) {
        offenders.push(path.relative(SRC_ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
