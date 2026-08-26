import { describe, it, expect } from '@jest/globals';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { findBackendRoot } from '../lib/backend-root.js';

/**
 * Regression: production answered 404 to every contract download because the
 * path resolved to /usr/lib/node_modules/pm2/assets/contracts/. pm2 sets
 * process.argv[1] to its own ProcessContainer.js, and the old resolver
 * accepted the first ancestor containing any package.json.
 */
describe('findBackendRoot', () => {
  it('finds a directory that actually is the backend package', () => {
    const root = findBackendRoot();
    expect(existsSync(resolve(root, 'prisma', 'schema.prisma'))).toBe(true);
  });

  it('resolves the contract template to a file that exists', () => {
    const pdf = resolve(findBackendRoot(), 'assets', 'contracts', 'Personalfragebogen_NEU.pdf');
    expect(existsSync(pdf)).toBe(true);
  });

  // The precise production failure: argv[1] pointing into an unrelated
  // package must not drag the resolution in with it.
  it('ignores an argv[1] that belongs to a process manager', () => {
    const original = process.argv[1];
    try {
      process.argv[1] = '/usr/lib/node_modules/pm2/lib/ProcessContainer.js';
      const root = findBackendRoot();
      expect(root).not.toMatch(/node_modules/);
      expect(existsSync(resolve(root, 'prisma', 'schema.prisma'))).toBe(true);
    } finally {
      process.argv[1] = original as string;
    }
  });

  it('still resolves when argv[1] is absent entirely', () => {
    const original = process.argv[1];
    try {
      // Simulates an embedder that sets no argv[1] at all.
      process.argv.splice(1, 1);
      expect(existsSync(resolve(findBackendRoot(), 'prisma', 'schema.prisma'))).toBe(true);
    } finally {
      process.argv.splice(1, 0, original as string);
    }
  });
});
