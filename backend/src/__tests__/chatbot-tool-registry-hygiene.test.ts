import { describe, it, expect, jest } from '@jest/globals';

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
        const tokens = Array.isArray(tool.permission) ? tool.permission : [tool.permission];
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

  it('registers no write tool while OD-CHAT-005 is unresolved', () => {
    // OD-CHAT-005 (read-scope and initiation-scope beyond the owning worker)
    // is a standing G2-freeze blocker. Until it is ratified, the registry
    // stays read-only — this test is the mechanical expression of that, and
    // is expected to be updated deliberately when the decision lands.
    const writeTools = listTools().filter((t) => t.tier !== 'READ_ONLY');
    expect(writeTools.map((t) => t.name)).toEqual([]);
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
