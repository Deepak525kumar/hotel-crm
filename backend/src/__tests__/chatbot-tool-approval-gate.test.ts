import { describe, it, expect, jest } from '@jest/globals';

/**
 * ADR-053 item 4 — "each tool integration is its own explicit future
 * approval" — was, until 2026-09-08, honoured by convention alone.
 *
 * `approvalRef` merely had to be non-empty, and the string `'PENDING -- ...'`
 * satisfied that perfectly. The platform would have booted, served, and
 * executed a tool nobody had approved, with nothing anywhere saying so. The
 * only thing standing between an unreviewed capability and production was
 * someone remembering.
 *
 * `assertAllToolsApproved()` is that gate made mechanical.
 */

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
    warn: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
    debug: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
    error: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
  },
}));

jest.mock('../config/env.js', () => ({
  getEnv: () => ({ NODE_ENV: 'test' }),
  loadEnv: jest.fn() as jest.MockedFunction<(...a: unknown[]) => unknown>,
}));

import { readFileSync } from 'node:fs';
import { assertAllToolsApproved, listTools } from '../modules/chatbot/tools/registry.js';
// Registers every tool definition as an import side effect.
import '../modules/chatbot/service.js';

describe('the tool-approval boot gate', () => {
  /**
   * BEHAVIOUR, NOT A HEADCOUNT. The first version of this asserted the gate
   * never throws with the real registry -- true the day it was written, when
   * every tool was approved, and false the moment a new tool was registered
   * awaiting approval. Two PRs whose CI each passed against a main lacking the
   * other then merged and broke main between them.
   *
   * A registry containing an unapproved tool is a NORMAL, expected state --
   * it is what every new tool looks like before its decision. The gate's job
   * is to refuse to BOOT in that state, not to be un-triggerable, so what is
   * pinned here is the correspondence between the two.
   */
  it('throws exactly when an unapproved tool is registered, and not otherwise', () => {
    const pending = listTools().filter((t) => /\bPENDING\b/i.test(t.approvalRef));

    if (pending.length === 0) {
      expect(() => assertAllToolsApproved()).not.toThrow();
      return;
    }

    let message = '';
    try {
      assertAllToolsApproved();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/not approved/i);
    // Every offender named, so the owner knows what they are approving.
    for (const tool of pending) expect(message).toContain(tool.name);
  });

  it('states an approval properly whenever it states one at all', () => {
    expect(listTools().length).toBeGreaterThan(0);

    for (const tool of listTools()) {
      if (/\bPENDING\b/i.test(tool.approvalRef)) {
        // Awaiting a decision is allowed; saying nothing is not.
        expect(tool.approvalRef.trim().length).toBeGreaterThan(0);
        continue;
      }
      // A non-empty string was the ONLY previous requirement, and 'PENDING'
      // met it. An actual approval must name a date and an authority.
      expect({ tool: tool.name, ref: tool.approvalRef }).toEqual({
        tool: tool.name,
        ref: expect.stringMatching(/APPROVED \d{4}-\d{2}-\d{2}/),
      });
      expect(tool.approvalRef).toMatch(/ADR-053 item 4/);
    }
  });

  /**
   * The failure mode the gate is MOST likely to have, and did have during
   * development: called before the definitions are imported, the registry is
   * empty, and it passes vacuously while appearing to work.
   */
  it('refuses an empty registry rather than passing vacuously', async () => {
    // A fresh module registry, with the definitions deliberately NOT imported.
    await jest.isolateModulesAsync(async () => {
      const registry = await import('../modules/chatbot/tools/registry.js');
      expect(registry.listTools()).toHaveLength(0);
      expect(() => registry.assertAllToolsApproved()).toThrow(/no tools are registered/i);
    });
  });

  it('names every offending tool, not just the first', async () => {
    await jest.isolateModulesAsync(async () => {
      const registry = await import('../modules/chatbot/tools/registry.js');
      const { z } = await import('zod');

      const make = (name: string, approvalRef: string) =>
        registry.registerTool({
          name,
          description: 'x',
          tier: 'READ_ONLY' as const,
          confirm: false,
          args: z.object({}).strict(),
          permission: null,
          permissionRationale: 'test fixture',
          scopeCheck: 'self' as const,
          interfaceRef: 'IF-TEST',
          approvalRef,
          invoke: async () => ({ summary: '', data: null }),
        } as never);

      make('test.approved', 'APPROVED 2026-09-08 under ADR-053 item 4');
      make('test.pending_one', 'PENDING -- awaiting approval');
      make('test.pending_two', 'PENDING -- also awaiting');

      let message = '';
      try {
        registry.assertAllToolsApproved();
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toMatch(/test\.pending_one/);
      expect(message).toMatch(/test\.pending_two/);
      // The approved one must not be blamed.
      expect(message).not.toMatch(/test\.approved/);
      expect(message).toMatch(/2 tool\(s\)/);
    });
  });
});

/**
 * The gate is worthless if it is never called, or called with the flag off.
 * Asserted against the real boot file, because that wiring is the whole
 * control and a refactor could quietly drop it.
 */
describe('the gate is actually wired into boot', () => {
  /**
   * COMMENTS STRIPPED FIRST. The naive version of this suite matched
   * `app.listen(` inside the explanatory comment ABOVE the guard and
   * concluded the ordering was wrong when it was correct -- a source-text
   * assertion that failed on prose, not on code. Strip first, then assert.
   */
  const server = readFileSync('src/server.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('is called at startup, behind the feature flag', () => {
    expect(server).toMatch(/isChatbotEnabled\(\)/);
    expect(server).toMatch(/assertAllToolsApproved\(\)/);
  });

  it('runs AFTER createApp(), which is what registers the tools', () => {
    // Before it, the registry is empty and the check is meaningless. The
    // empty-registry guard above would now catch that, but ordering is the
    // real fix and this pins it.
    const createApp = server.indexOf('createApp()');
    const assertCall = server.indexOf('assertAllToolsApproved()');
    expect(createApp).toBeGreaterThan(-1);
    expect(assertCall).toBeGreaterThan(createApp);
  });

  it('runs BEFORE the server accepts a request', () => {
    const assertCall = server.indexOf('assertAllToolsApproved()');
    const listen = server.indexOf('app.listen(');
    expect(listen).toBeGreaterThan(-1);
    expect(assertCall).toBeLessThan(listen);
  });
});
