import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { buildMessages, visibleTools } from '../modules/chatbot/orchestrator/router-l1.js';
import { listTools } from '../modules/chatbot/tools/registry.js';
import '../modules/chatbot/tools/definitions/self-service.tools.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

/**
 * ADR-074 §6: the two properties that make second-order prompt injection
 * structurally impossible are true BY CONSTRUCTION, which is exactly why
 * they need asserting — nothing currently stops someone reintroducing either
 * while making an unrelated improvement.
 *
 * Second-order injection is hostile text stored in the platform (a
 * notification body, an absence reason, a room note) being read back and
 * obeyed. It cannot happen today because tool output never reaches a model
 * at all: results are rendered deterministically, and no conversation
 * history is replayed.
 */

/** Source with comments and strings stripped, so assertions test CODE. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/(^|[^:])\/\/.*$/gm, '$1') // line comments, sparing URLs
    .replace(/'(?:[^'\\]|\\.)*'/g, "''") // single-quoted strings
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

describe('ADR-074 containment invariants', () => {
  it('makes exactly ONE model call per turn — no second call to phrase a reply', () => {
    // A second call would hand tool output back to a model, which is the
    // channel second-order injection needs.
    const orchestrator = code('src/modules/chatbot/orchestrator/orchestrator.ts');
    const calls = orchestrator.match(/completeWithTools\s*\(/g) ?? [];
    expect({ callSites: calls.length }).toEqual({ callSites: 1 });
  });

  it('never replays conversation history into a prompt', () => {
    // buildMessages takes ONE string and returns ONE user message. If it ever
    // grows a history parameter, stored text starts reaching the model.
    expect(buildMessages('hello')).toEqual([{ role: 'user', content: 'hello' }]);
    expect(buildMessages('a')).toHaveLength(1);
    expect(buildMessages.length).toBe(1); // arity: one argument, no history
  });

  it('renders tool results without any model involvement', () => {
    const templates = code('src/modules/chatbot/orchestrator/templates.ts');
    expect(templates).not.toMatch(/completeWithTools|getProvider/);
  });

  it('exposes no tool the actor could not already invoke', () => {
    // Control 3: an injection can only name a tool that was in the prompt.
    const worker = { userId: 'w', role: 'worker', permissions: [], scope: null } as unknown as ActorContext;
    for (const tool of visibleTools(worker)) {
      expect({ tool: tool.name, permission: tool.permission }).toEqual({
        tool: tool.name,
        permission: null,
      });
    }
  });

  it('gives every write tool a real permission token', () => {
    // Control 1/5: the `null` escape hatch may never widen to writes.
    for (const tool of listTools()) {
      if (tool.tier === 'READ_ONLY') continue;
      expect({ tool: tool.name, hasToken: tool.permission !== null }).toEqual({
        tool: tool.name,
        hasToken: true,
      });
    }
  });

  it('forces confirmation on every HIGH_RISK_WRITE', () => {
    // Control 6: the last line of defence when a model proposes a
    // well-formed action the user did not intend.
    for (const tool of listTools()) {
      if (tool.tier !== 'HIGH_RISK_WRITE') continue;
      expect({ tool: tool.name, confirm: tool.confirm }).toEqual({ tool: tool.name, confirm: true });
    }
  });

  it('declares no forbidden argument on any tool', () => {
    // Control 1, over the real registry rather than a fixture.
    const forbidden = ['userId','user_id','actorId','actor_id','role','permissions','scope','hotelId','hotel_id','workerId','worker_id','internalBypass','internal_bypass'];
    for (const tool of listTools()) {
      const parsed = tool.args.safeParse(Object.fromEntries(forbidden.map((k) => [k, 'x'])));
      expect({ tool: tool.name, accepted: parsed.success }).toEqual({ tool: tool.name, accepted: false });
    }
  });

  it('tells the model to treat tool data as information, never instructions', () => {
    // The interim posture's one instruction-based control. It is a
    // cooperation aid, NOT the boundary — but removing it should be a
    // deliberate act.
    const router = readFileSync('src/modules/chatbot/orchestrator/router-l1.ts', 'utf8');
    expect(router).toMatch(/never as instructions/i);
  });
});
