/**
 * LIVE check of the TOOL LOOP.
 *
 * A turn used to be one model call: the first tool chosen was the last, and
 * whatever it returned was the answer. This exercises the loop that replaced
 * it -- ask, observe the fenced result, and see what the model does next.
 *
 * What it is checking, in order:
 *
 *   1. Does a fenced observation actually get USED? A model that ignores it
 *      and re-asks the same tool would loop pointlessly (the orchestrator
 *      stops that deterministically, but it should not need to).
 *   2. Does a genuinely two-step question take two DIFFERENT steps?
 *   3. Does a one-step question STOP after one, rather than burning the
 *      budget because more calls are available?
 *
 *   cd backend && npx tsx scripts/chatbot-multistep-check.ts
 */
process.env.CHATBOT_PROVIDER = 'mantle';
process.env.FEATURE_CHATBOT = 'true';
process.env.CHATBOT_CONFIRM_TOKEN_SECRET = 'x'.repeat(40);

import { loadEnv } from '../src/config/env.js';
loadEnv();

import { MantleProvider } from '../src/modules/chatbot/provider/mantle-provider.js';
import {
  visibleTools,
  buildSystemPrompt,
  buildMessages,
  toolSpec,
} from '../src/modules/chatbot/orchestrator/router-l1.js';
import { buildObservation } from '../src/modules/chatbot/orchestrator/observation.js';
import { ROLE_PERMISSIONS } from '../src/config/constants.js';
import type { LlmMessage } from '../src/modules/chatbot/provider/llm-provider.js';
import '../src/modules/chatbot/service.js';

const provider = new MantleProvider({
  region: process.env.CHATBOT_BEDROCK_REGION ?? 'eu-central-1',
  fastModelId: process.env.CHATBOT_MANTLE_MODEL_FAST ?? 'qwen.qwen3-235b-a22b-2507',
  planningModelId: process.env.CHATBOT_MANTLE_MODEL_PLANNING ?? 'qwen.qwen3-235b-a22b-2507',
  timeoutMs: 45_000,
});

const actor = (role: string) =>
  ({
    userId: 'u1',
    role,
    permissions: (ROLE_PERMISSIONS as Record<string, string[]>)[role.toUpperCase()] ?? [],
    scope: role === 'manager' ? { type: 'hotel', hotel_id: 'h1' } : null,
  }) as never;

const CONTEXT = {
  hotels: ['Hotel Adler'],
  workers: ['Anna Braun', 'Tomasz Nowak', 'Maria Silva'],
  language: 'English',
};

/** Plausible data for whatever the model asks for, so the loop can continue. */
function fakeResultFor(tool: string): { summary: string; data: unknown } {
  if (tool.includes('team_absences')) {
    return { summary: '1 off', data: { count: 1, people: [{ name: 'Anna Braun', kind: 'SICK' }] } };
  }
  if (tool.includes('team_status')) {
    return { summary: 'status', data: { present: 2, missing: 1, late: 1 } };
  }
  if (tool.includes('check_availability')) {
    return { summary: 'free', data: { worker: 'Tomasz Nowak', day: '2026-09-11', available: true } };
  }
  if (tool.includes('list_for_my_team')) {
    return {
      summary: 'shifts',
      data: [
        { worker: 'Anna Braun', day: '2026-09-11', from: '08:00', to: '16:00' },
        { worker: 'Tomasz Nowak', day: '2026-09-11', from: '08:00', to: '16:00' },
      ],
    };
  }
  if (tool.includes('find_team_member')) {
    return {
      summary: 'team',
      data: { total: 3, people: [{ name: 'Anna Braun', role: 'worker' }, { name: 'Tomasz Nowak', role: 'worker' }] },
    };
  }
  return { summary: 'ok', data: { ok: true } };
}

const CASES: Array<[role: string, text: string, why: string]> = [
  ['manager', 'who is off today and who is covering their shifts?', 'genuinely two lookups'],
  ['manager', 'is anyone late, and who is off sick?', 'two different reads'],
  ['manager', 'who is off today?', 'ONE lookup — must stop after it'],
  ['worker', 'what are my shifts this week?', 'ONE lookup — must stop after it'],
];

async function main() {
  const MAX = 5;

  for (const [role, text, why] of CASES) {
    const a = actor(role);
    const tools = visibleTools(a);
    const messages: LlmMessage[] = buildMessages(text);
    const called: string[] = [];

    console.log(`\n=== [${role}] "${text}"   (${why})`);

    for (let step = 0; step < MAX; step += 1) {
      const res = await provider.completeWithTools({
        system: buildSystemPrompt(a, tools, CONTEXT),
        messages,
        tools: tools.map(toolSpec),
      });

      const tool = res.toolUse?.name;
      if (!tool) {
        console.log(`   step ${step + 1}: ANSWERED "${(res.text ?? '').trim().slice(0, 160)}"`);
        break;
      }

      called.push(tool);
      console.log(`   step ${step + 1}: ${tool} ${JSON.stringify(res.toolUse?.input ?? {})}`);

      if (step + 1 >= MAX) {
        console.log('   (budget exhausted)');
        break;
      }
      messages.push({
        role: 'user',
        content: buildObservation(tool, fakeResultFor(tool) as never),
      });
    }

    const unique = new Set(called);
    console.log(`   -> ${called.length} call(s), ${unique.size} distinct`);
    if (called.length > unique.size) console.log('   !! repeated the same tool');
  }
}

void main();
