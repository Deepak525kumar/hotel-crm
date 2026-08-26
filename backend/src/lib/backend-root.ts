import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Present under ts-jest/CommonJS via the module wrapper; absent under native
// ESM (`"type": "module"`, which is how production runs).
declare const __dirname: string | undefined;

/**
 * Locates the backend package root.
 *
 * The previous implementations (config/env.ts's backendRoot and hr/service.ts's
 * contract-PDF path) walked up from `process.argv[1]` and accepted the first
 * directory containing ANY package.json. Under a process manager that is
 * catastrophically wrong: pm2 sets `process.argv[1]` to its own
 * `ProcessContainer.js`, so the walk found `/usr/lib/node_modules/pm2/
 * package.json` and every subsequent read resolved inside pm2's installation.
 * Production logged
 *
 *   hr_default_contract_pdf_missing
 *   {"path":"/usr/lib/node_modules/pm2/assets/contracts/Personalfragebogen_NEU.pdf",
 *    "error":"ENOENT"}
 *
 * and answered 404 to every contract download. It was not intermittent: the
 * app is ESM, so `__dirname` is always undefined in production and the broken
 * branch was always the one taken.
 *
 * The fix is to look for a marker only THIS package has, rather than for the
 * generic existence of a package.json. `prisma/schema.prisma` is that marker.
 */
function hasMarker(dir: string): boolean {
  return existsSync(resolve(dir, 'prisma', 'schema.prisma'));
}

function walkUp(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 10; i += 1) {
    if (hasMarker(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function findBackendRoot(): string {
  const candidates = [
    // ts-jest / CommonJS.
    ...(typeof __dirname !== 'undefined' ? [__dirname] : []),
    // `node dist/server.js` launched directly.
    ...(process.argv[1] ? [dirname(resolve(process.argv[1]))] : []),
    // Launched by a process manager: argv[1] belongs to the manager, so the
    // working directory is the only honest anchor. pm2 runs this repo with
    // cwd at the repository root, hence the `backend` candidate.
    process.cwd(),
    resolve(process.cwd(), 'backend'),
  ];

  for (const candidate of candidates) {
    const found = walkUp(candidate);
    if (found) return found;
  }

  // Nothing matched. Return a plausible path so the resulting ENOENT names
  // somewhere recognisable rather than a process manager's install directory.
  return typeof __dirname !== 'undefined' ? resolve(__dirname, '..', '..') : process.cwd();
}
