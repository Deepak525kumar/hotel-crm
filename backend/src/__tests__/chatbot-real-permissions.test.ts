import { describe, it, expect, jest } from '@jest/globals';

/**
 * Every registered tool must be usable by the role it exists for — checked
 * against the REAL `ROLE_PERMISSIONS` sets, never a fabricated fixture.
 *
 * This suite exists because of a defect it would have caught:
 * `assignments.list_mine` originally required `staffing:read`, which the
 * WORKER role does not hold. Every other chatbot test passed, because they
 * all built their own `permissions: ['staffing:read']` actor. The tool built
 * for workers would have denied every worker in production, and nothing in a
 * green suite said so.
 *
 * The lesson generalizes: a permission assertion written against invented
 * permissions proves only that the code agrees with itself.
 */

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

jest.mock('../config/env.js', () => ({
  getEnv: () => ({ NODE_ENV: 'test' }),
  loadEnv: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
}));

jest.mock('../lib/db.js', () => ({
  getPrisma: () => ({
    workerAssignment: { findMany: async () => [], count: async () => 0 },
    roomsCompletedEntry: { findMany: async () => [] },
    user: { findMany: async () => [] },
    auditLog: { create: async () => ({}) },
  }),
}));

import { ROLE_PERMISSIONS } from '../config/constants.js';
import { listTools } from '../modules/chatbot/tools/registry.js';
import { actorHasPermission } from '../modules/chatbot/tools/executor.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';
// Registers the tool definitions.
import '../modules/chatbot/service.js';

/** Builds an actor from the REAL permission set for a role. */
function realActor(role: keyof typeof ROLE_PERMISSIONS): ActorContext {
  return {
    userId: 'u1',
    role: String(role).toLowerCase(),
    permissions: ROLE_PERMISSIONS[role] ?? [],
    scope: null,
  } as unknown as ActorContext;
}

function canUse(tool: ReturnType<typeof listTools>[number], actor: ActorContext): boolean {
  return tool.permission === null || actorHasPermission(actor, tool.permission);
}

describe('registered tools vs. real ROLE_PERMISSIONS', () => {
  it('exposes the real WORKER permission set (guards the fixture-vs-reality gap)', () => {
    const worker = ROLE_PERMISSIONS.WORKER ?? [];
    expect(worker.length).toBeGreaterThan(0);
    // The specific fact the original defect turned on. If this ever becomes
    // true, revisit `assignments.list_mine`'s token — but do it deliberately.
    expect(worker).not.toContain('staffing:read');
  });

  it('lets a real WORKER use every self-scoped tool', () => {
    const worker = realActor('WORKER');
    const selfScoped = listTools().filter((t) => t.scopeCheck === 'self');

    expect(selfScoped.length).toBeGreaterThan(0);
    for (const tool of selfScoped) {
      expect({ tool: tool.name, usable: canUse(tool, worker) }).toEqual({
        tool: tool.name,
        usable: true,
      });
    }
  });

  it('lets a real ADMIN use every tool', () => {
    const admin = realActor('ADMIN');
    for (const tool of listTools()) {
      expect({ tool: tool.name, usable: canUse(tool, admin) }).toEqual({
        tool: tool.name,
        usable: true,
      });
    }
  });

  it('never registers a tool no real role can use', () => {
    const roles = Object.keys(ROLE_PERMISSIONS) as Array<keyof typeof ROLE_PERMISSIONS>;
    for (const tool of listTools()) {
      const usableBy = roles.filter((r) => canUse(tool, realActor(r)));
      expect({ tool: tool.name, usableByCount: usableBy.length > 0 }).toEqual({
        tool: tool.name,
        usableByCount: true,
      });
    }
  });

  /**
   * The claim the `anyOf` form was added to make good on: the HR self-reads
   * are gated role-conditionally at the route (worker/checker on the
   * `*:read-own` token, everyone else on `hr:read`), and EVERY role can read
   * its own contract and payslips -- just never through a single token.
   *
   * Before `anyOf` these two were `permission: null` with a paragraph of
   * rationale, which meant this suite's self-scoped test passed over them
   * without asserting anything. Named explicitly so the coverage is real.
   */
  it.each([['hr.my_contract'], ['hr.my_payslips']])(
    'lets every real role reach %s, matching the role-conditional route gate',
    (toolName) => {
      const tool = listTools().find((t) => t.name === toolName);
      expect(tool).toBeDefined();
      // Not null: the whole point is that the gate is now DECLARED.
      expect(tool!.permission).not.toBeNull();

      const roles = Object.keys(ROLE_PERMISSIONS) as Array<keyof typeof ROLE_PERMISSIONS>;
      for (const role of roles) {
        expect({ role, usable: canUse(tool!, realActor(role)) }).toEqual({ role, usable: true });
      }
    }
  );

  it('constrains any token-less tool to READ_ONLY + self-scoped + rationale', () => {
    for (const tool of listTools().filter((t) => t.permission === null)) {
      expect({
        tool: tool.name,
        tier: tool.tier,
        scope: tool.scopeCheck,
        hasRationale: Boolean(tool.permissionRationale?.trim()),
      }).toEqual({
        tool: tool.name,
        tier: 'READ_ONLY',
        scope: 'self',
        hasRationale: true,
      });
    }
  });
});
