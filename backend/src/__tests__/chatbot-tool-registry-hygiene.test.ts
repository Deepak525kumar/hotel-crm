import { describe, it, expect, jest } from '@jest/globals';
import { actorHasPermission } from '../modules/chatbot/tools/executor.js';

/**
 * Static hygiene checks over the whole tool registry, in the spirit of
 * `__tests__/support/route-registry.ts`'s permission-token test: invariants
 * that must hold for EVERY registration, present and future, enforced
 * mechanically rather than by reviewer diligence.
 *
 * A new tool that violates any of these fails CI without anyone having to
 * remember the rule.
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
  getEnv: () => ({ NODE_ENV: 'test', FEATURE_CHATBOT: true }),
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

import { z } from 'zod';
import {
  FORBIDDEN_ARG_KEYS,
  assertValidRegistration,
  describeSchemaKeys,
  listTools,
  permissionTokens,
  resolveTool,
} from '../modules/chatbot/tools/registry.js';
// Importing the service registers every tool definition as a side effect.
import '../modules/chatbot/service.js';

describe('tool registry hygiene — every registered tool', () => {
  it('registers at least one tool (guards against a vacuous pass)', () => {
    expect(listTools().length).toBeGreaterThan(0);
  });

  it('declares no authorization argument in its schema', () => {
    for (const tool of listTools()) {
      const keys = describeSchemaKeys(tool.args);
      const offending = keys.filter((k) => (FORBIDDEN_ARG_KEYS as readonly string[]).includes(k));
      expect({ tool: tool.name, offending }).toEqual({ tool: tool.name, offending: [] });
    }
  });

  it('requires confirmation for every HIGH_RISK_WRITE tool (ADR-053 item 5)', () => {
    for (const tool of listTools()) {
      if (tool.tier === 'HIGH_RISK_WRITE') {
        expect({ tool: tool.name, confirm: tool.confirm }).toEqual({
          tool: tool.name,
          confirm: true,
        });
      }
    }
  });

  it('names the module interface it wraps and the decision that approved it', () => {
    // ADR-053 item 2 (no bespoke backend capability for the chatbot's
    // benefit) and item 4 (each tool is its own explicit approval).
    for (const tool of listTools()) {
      expect(tool.interfaceRef.length).toBeGreaterThan(0);
      expect(tool.approvalRef.length).toBeGreaterThan(0);
    }
  });

  it('declares a usable permission token (or a justified absence) and a result cap', () => {
    for (const tool of listTools()) {
      if (tool.permission === null) {
        // A token-less tool is legitimate only when the wrapped route enforces
        // no token either — constrained hard by assertValidRegistration and
        // asserted in chatbot-real-permissions.test.ts.
        expect(tool.permissionRationale?.trim()).toBeTruthy();
      } else {
        const tokens = permissionTokens(tool.permission);
        expect(tokens.length).toBeGreaterThan(0);
        expect(tokens.every((t) => t.length > 0)).toBe(true);
      }
      expect(tool.maxResultTokens).toBeGreaterThan(0);
    }
  });

  it('uses a strict schema, so unexpected model output is rejected not ignored', () => {
    for (const tool of listTools()) {
      const parsed = tool.args.safeParse({ __unexpected_key__: 1 });
      expect({ tool: tool.name, accepted: parsed.success }).toEqual({
        tool: tool.name,
        accepted: false,
      });
    }
  });

  // OD-CHAT-005 CLOSED 2026-09-04 by ADR-073 (Accepted): a user may do
  // through the assistant exactly what they can do by hand, within their own
  // scope. The blanket "no write tool" assertion that stood here has done its
  // job and is replaced — deliberately, as its own comment anticipated — by
  // the invariants that now bound writes. The guard tightens; it does not go
  // away.
  it('gives every write tool a REAL permission token, never the null escape hatch', () => {
    // `permission: null` is admitted only for READ_ONLY self-scoped tools
    // whose wrapped route enforces nothing. Letting it widen to writes would
    // turn a narrow, justified exception into the way writes get registered.
    //
    // This is not theoretical: it blocked "mark my notification read" and
    // "record my own sick day", because those self-service routes are
    // authMiddleware-only. That tension is real and is an owner decision
    // (give those routes tokens, or relax this rule) — not something to work
    // around by loosening the guard.
    for (const tool of listTools()) {
      if (tool.tier === 'READ_ONLY') continue;
      expect({ tool: tool.name, permission: tool.permission }).not.toEqual({
        tool: tool.name,
        permission: null,
      });
    }
  });

  it('forces confirmation on every HIGH_RISK_WRITE (ADR-053 item 5)', () => {
    // Enforced at registration too. Asserted here so the guarantee is
    // visible where someone adding a tool will read it.
    for (const tool of listTools()) {
      if (tool.tier !== 'HIGH_RISK_WRITE') continue;
      expect({ tool: tool.name, confirm: tool.confirm }).toEqual({
        tool: tool.name,
        confirm: true,
      });
    }
  });

  it('records an approval reference for every write tool (ADR-053 item 4)', () => {
    // The architecture is approved; each tool is its own approval. A write
    // tool with no stated approval status is one nobody signed off.
    for (const tool of listTools()) {
      if (tool.tier === 'READ_ONLY') continue;
      expect(tool.approvalRef.length).toBeGreaterThan(0);
    }
  });

  it('registers no analytics tool while OQ-ANALYTICS-01 is open', () => {
    // API_INDEX.yaml records the analytics leaderboard routes as missing
    // requireRole/checkHotelAccess. Wrapping a broken route in a tool would
    // industrialize the breakage.
    const analytics = listTools().filter((t) => t.name.startsWith('analytics.'));
    expect(analytics.map((t) => t.name)).toEqual([]);
  });
});

describe('tool registry hygiene — registration-time guards reject bad tools', () => {
  const base = {
    name: 'test.tool',
    description: 'x',
    interfaceRef: 'IF-TEST',
    approvalRef: 'TEST',
    permission: 'staffing:read',
    scopeCheck: 'self' as const,
    invoke: async () => null,
    compress: () => ({ summary: '', data: null }),
    maxResultTokens: 100,
  };

  it('throws on a HIGH_RISK_WRITE tool that does not require confirmation', () => {
    expect(() =>
      assertValidRegistration({
        ...base,
        tier: 'HIGH_RISK_WRITE',
        confirm: false,
        args: z.object({}).strict(),
      } as any)
    ).toThrow(/must require confirmation/);
  });

  it.each(FORBIDDEN_ARG_KEYS)('throws on a schema declaring %s', (key) => {
    expect(() =>
      assertValidRegistration({
        ...base,
        tier: 'READ_ONLY',
        confirm: false,
        args: z.object({ [key]: z.string() }).strict(),
      } as any)
    ).toThrow(/forbidden authorization argument/);
  });

  it('accepts a well-formed read-only registration', () => {
    expect(() =>
      assertValidRegistration({
        ...base,
        tier: 'READ_ONLY',
        confirm: false,
        args: z.object({ limit: z.number() }).strict(),
      } as any)
    ).not.toThrow();
  });
});

describe('tool lookup is allow-listed', () => {
  it('does not resolve inherited object members', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect(resolveTool(name)).toBeUndefined();
    }
  });

  it('does not resolve an unregistered name', () => {
    expect(resolveTool('assignments.drop_table')).toBeUndefined();
  });
});

/**
 * `anyOf` is an OR, and it is the only OR in the permission model. Its
 * semantics are asserted directly rather than only through the tools that
 * happen to use it today, because a subtle change here would quietly widen
 * or narrow access everywhere at once.
 */
describe('permission: anyOf', () => {
  const actor = (permissions: string[]) =>
    ({ userId: 'u1', role: 'worker', permissions, scope: null }) as unknown as Parameters<
      typeof actorHasPermission
    >[0];

  const GATE = { anyOf: ['hr:read', 'hr:contract:read-own'] };

  it('admits an actor holding EITHER token', () => {
    expect(actorHasPermission(actor(['hr:read']), GATE)).toBe(true);
    expect(actorHasPermission(actor(['hr:contract:read-own']), GATE)).toBe(true);
  });

  it('denies an actor holding neither', () => {
    expect(actorHasPermission(actor(['staffing:read']), GATE)).toBe(false);
    expect(actorHasPermission(actor([]), GATE)).toBe(false);
  });

  it('applies wildcards inside anyOf exactly as it does outside', () => {
    expect(actorHasPermission(actor(['hr:*']), GATE)).toBe(true);
    expect(actorHasPermission(actor(['admin:*']), GATE)).toBe(true);
    // A wildcard on an unrelated resource must not leak across.
    expect(actorHasPermission(actor(['staffing:*']), GATE)).toBe(false);
  });

  it('refuses to register an empty anyOf, which would deny everyone silently', () => {
    expect(() =>
      assertValidRegistration({
        name: 'test.empty_any_of',
        description: 'x',
        tier: 'READ_ONLY',
        confirm: false,
        args: z.object({}).strict(),
        permission: { anyOf: [] },
        scopeCheck: 'self',
        interfaceRef: 'x',
        approvalRef: 'x',
        invoke: async () => ({ summary: '', data: null }),
      } as never)
    ).toThrow(/anyOf/i);
  });

  it('flattens every form for inspection without deciding access', () => {
    expect(permissionTokens(null)).toEqual([]);
    expect(permissionTokens('hr:read')).toEqual(['hr:read']);
    expect(permissionTokens(['a', 'b'])).toEqual(['a', 'b']);
    expect(permissionTokens({ anyOf: ['a', 'b'] })).toEqual(['a', 'b']);
  });
});
