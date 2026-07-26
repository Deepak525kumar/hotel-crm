import { describe, it, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

// ADR-031 D-4 (PR-4, still binding as of PR-7): "no module other than
// backend-auth writes token_generation directly." Enforced here as a static
// grep over src/, in the spirit of ADR-030 D-8's invariant test
// (permission-token-hygiene.test.ts) — a future PR incrementing
// `token_generation` outside the designated seam fails this test rather
// than silently reintroducing a second writer.
//
// The companion "no handler reads User.permissions" half of this invariant
// (formerly enforced here too) is retired as of ADR-031 M-3/PR-7: the
// column itself is dropped, so any attempted read is now a TypeScript
// compile error against the Prisma-generated User type — a stronger,
// build-time guarantee that makes the runtime grep redundant for that half.

const SRC_ROOT = path.join(__dirname, '..');

// The seam itself legitimately writes token_generation and must not trip
// the invariant.
const ALLOWED_TOKEN_GENERATION_WRITE_FILES = new Set([
  path.join(SRC_ROOT, 'modules/auth/service.ts'),
  path.join(SRC_ROOT, 'middleware/auth.ts'), // reads, does not write
]);

const EXCLUDED_DIRS = new Set(['__tests__', 'node_modules']);

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

describe('ADR-031 D-4: token_generation write-seam invariant', () => {
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
});
