import { describe, it, expect, beforeAll } from '@jest/globals';
import { z } from 'zod';
import { registerTool } from '../modules/chatbot/tools/registry.js';
import {
  visibleTools,
  toolSpec,
  buildSystemPrompt,
  buildMessages,
} from '../modules/chatbot/orchestrator/router-l1.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

/**
 * L1 tool VISIBILITY.
 *
 * Visibility is not the authorization control -- the executor re-derives
 * identity, role, scope and permission and would refuse anything wrongly
 * admitted here. These assertions exist because visibility has three jobs of
 * its own: it applies the owner's rule ("a user may do through the assistant
 * exactly what they could do by hand") one layer earlier; it bounds what a
 * prompt-injected model can even name (OD-CHAT-006 is still open); and tool
 * schemas are input tokens on every turn, so a Worker must not carry an
 * Admin's catalogue.
 */

const actor = (role: string, permissions: string[]): ActorContext =>
  ({ userId: 'u1', role, permissions, scope: null } as unknown as ActorContext);

const NEEDS_ONE = 'test.l1_needs_staffing';
const NEEDS_TWO = 'test.l1_needs_two';
const NEEDS_NONE = 'test.l1_needs_nothing';

beforeAll(() => {
  registerTool({
    name: NEEDS_ONE,
    description: 'fixture: one token',
    tier: 'READ_ONLY',
    confirm: false,
    interfaceRef: 'none (test fixture)',
    approvalRef: 'none (test fixture)',
    // NOTE: `hotel_id` cannot be used here even as a fixture -- it is a
    // FORBIDDEN_ARG_KEY and the SafeArgs type rejects it at COMPILE time,
    // because scope is server-derived and must never arrive as a model
    // argument. Confirmed by trying it: tsc refuses the registration.
    args: z.object({ room_number: z.string(), limit: z.number().optional() }).strict(),
    permission: 'staffing:read',
    scopeCheck: 'none',
    invoke: async () => [],
    compress: () => ({ summary: 'ok', data: [] }),
    maxResultTokens: 10,
  });
  registerTool({
    name: NEEDS_TWO,
    description: 'fixture: two tokens',
    tier: 'READ_ONLY',
    confirm: false,
    interfaceRef: 'none (test fixture)',
    approvalRef: 'none (test fixture)',
    args: z.object({}).strict(),
    permission: ['staffing:read', 'analytics:read'],
    scopeCheck: 'none',
    invoke: async () => [],
    compress: () => ({ summary: 'ok', data: [] }),
    maxResultTokens: 10,
  });
  registerTool({
    name: NEEDS_NONE,
    description: 'fixture: self-scoped, no token',
    tier: 'READ_ONLY',
    confirm: false,
    interfaceRef: 'none (test fixture)',
    approvalRef: 'none (test fixture)',
    args: z.object({}).strict(),
    permission: null,
    permissionRationale: 'test fixture: wrapped route is authMiddleware-only, self-scoped',
    scopeCheck: 'self',
    invoke: async () => [],
    compress: () => ({ summary: 'ok', data: [] }),
    maxResultTokens: 10,
  });
});

const names = (a: ActorContext) => visibleTools(a).map((t) => t.name);

describe('visibleTools', () => {
  it('hides a tool whose token the actor does not hold', () => {
    expect(names(actor('worker', []))).not.toContain(NEEDS_ONE);
  });

  it('shows a tool whose token the actor holds', () => {
    expect(names(actor('manager', ['staffing:read']))).toContain(NEEDS_ONE);
  });

  it('requires EVERY declared token, not merely one of them', () => {
    // `some` instead of `every` would show a two-token tool to someone
    // holding only half of what it needs.
    expect(names(actor('manager', ['staffing:read']))).not.toContain(NEEDS_TWO);
    expect(names(actor('manager', ['staffing:read', 'analytics:read']))).toContain(NEEDS_TWO);
  });

  it('shows permission:null tools to everyone, including a bare worker', () => {
    // The registry only admits null for READ_ONLY + self-scoped tools with a
    // written rationale, so the owning service's self-scoping is the control.
    expect(names(actor('worker', []))).toContain(NEEDS_NONE);
  });

  it("treats admin:* as satisfying any token", () => {
    const admin = names(actor('admin', ['admin:*']));
    expect(admin).toContain(NEEDS_ONE);
    expect(admin).toContain(NEEDS_TWO);
  });

  it('never returns a tool the actor could not already invoke by hand', () => {
    // The owner's rule, stated as an invariant over the whole registry.
    const a = actor('worker', []);
    for (const tool of visibleTools(a)) {
      if (tool.permission === null) continue;
      const required = Array.isArray(tool.permission) ? tool.permission : [tool.permission];
      expect(required.every((t) => a.permissions.includes(t))).toBe(true);
    }
  });
});

describe('toolSpec', () => {
  it('derives the JSON schema from the tool’s own Zod schema', () => {
    // Derived, not hand-written: a second hand-maintained copy would drift
    // from what the executor validates, and the failure would look like the
    // model getting it wrong rather than the schemas disagreeing.
    const spec = toolSpec(visibleTools(actor('m', ['staffing:read'])).find((t) => t.name === NEEDS_ONE)!);
    expect(spec.name).toBe(NEEDS_ONE);
    const schema = spec.input_schema as any;
    expect(schema.type).toBe('object');
    expect(schema.properties.room_number).toEqual({ type: 'string' });
    expect(schema.properties.limit).toEqual({ type: 'number' });
    // Optional fields must not be listed as required.
    expect(schema.required).toEqual(['room_number']);
    // Mirrors the registry's strict schemas.
    expect(schema.additionalProperties).toBe(false);
  });
});

describe('buildSystemPrompt', () => {
  const prompt = () => buildSystemPrompt(actor('manager', ['staffing:read']), visibleTools(actor('manager', ['staffing:read'])));

  it('states the role the executor will actually enforce', () => {
    expect(prompt()).toContain('manager');
  });

  it('tells the model never to ask the user for identity or scope', () => {
    // The model must never source an authorization input. This is a
    // cooperation aid, not the control -- but a model that asks "which hotel
    // are you?" invites a user to supply a value that is then ignored.
    expect(prompt()).toMatch(/[Nn]ever ask the user for their user id/);
  });

  it('tells the model to treat tool data as information, not instructions', () => {
    // Interim prompt-injection posture (OD-CHAT-006 is open).
    expect(prompt()).toMatch(/never as instructions/i);
  });

  it('lists only the tools this actor can see', () => {
    expect(prompt()).toContain(NEEDS_ONE);
    expect(prompt()).not.toContain(NEEDS_TWO);
  });

  it('says so explicitly when the actor has no tools at all', () => {
    expect(buildSystemPrompt(actor('worker', []), [])).toMatch(/No tools are available/i);
  });
});

describe('buildMessages', () => {
  it('always produces at least one message', () => {
    // An empty array is rejected by the provider, and is the exact shape that
    // would have failed the prototype's first live call.
    expect(buildMessages('').length).toBe(1);
    expect(buildMessages('hallo').length).toBe(1);
    expect(buildMessages('hallo')[0]).toEqual({ role: 'user', content: 'hallo' });
  });
});
