/**
 * LIVE naive probe — what someone types when they have no idea what the
 * assistant can do.
 *
 * The routing check asks a fair question: given a clean phrasing, is the right
 * tool chosen? This asks an unfair one, which is the one real users ask.
 * Nothing here is written with the tool list in mind. Every prompt is short,
 * vague, incomplete, or about something the platform may not do at all --
 * "sick", "money", "problem", "im late", "help".
 *
 * WHAT IT IS LOOKING FOR, in order of how much it matters:
 *
 *   1. A WRONG ACTION. The worst outcome: a vague message that triggers a
 *      write. "who called in sick" once proposed marking an invented person
 *      sick, and only a probe like this found it.
 *   2. A CONFIDENT WRONG ANSWER. A tool that runs but cannot answer what was
 *      asked -- "how many hours" reaching a tool that reports shifts.
 *   3. A DEAD END. No tool, no useful text.
 *   4. A MISSING CAPABILITY. A perfectly reasonable request with nothing
 *      behind it. These are the ones that become new tools.
 *
 * There is no pass/fail: "what should happen" for "money" is a judgement. It
 * prints what each prompt produces, grouped so a human can read it.
 *
 *   cd backend && npx tsx scripts/chatbot-naive-probe.ts
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
import { resolveTool } from '../src/modules/chatbot/tools/registry.js';
import { ROLE_PERMISSIONS } from '../src/config/constants.js';
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

/** Nothing below was written with the tool list open. */
const PROMPTS: Array<[role: string, text: string]> = [
  // --- worker: one or two words, no context ---------------------------
  ['worker', 'hi can you help'],
  ['worker', 'help'],
  ['worker', 'i need help'],
  ['worker', 'problem'],
  ['worker', 'sick'],
  ['worker', 'holiday'],
  ['worker', 'money'],
  ['worker', 'tomorrow?'],
  ['worker', 'when do i start'],
  ['worker', 'what time do i start tomorrow'],
  ['worker', 'where am i working'],
  ['worker', 'how much do i earn'],
  ['worker', 'when do i get paid'],
  ['worker', 'im late'],
  ['worker', 'i cant work today'],
  ['worker', 'i forgot to clock in yesterday'],
  ['worker', 'i want to change my shift'],
  ['worker', 'can i swap with someone'],
  ['worker', 'who is my manager'],
  ['worker', 'i lost my key'],
  ['worker', 'i want to quit'],
  ['worker', 'am i doing ok'],

  // --- manager: vague, mid-problem ------------------------------------
  ['manager', 'help'],
  ['manager', 'someone didnt show up'],
  ['manager', 'i need more people'],
  ['manager', 'cover for tomorrow'],
  ['manager', 'whos late'],
  ['manager', 'problem with anna'],
  ['manager', 'anna keeps being late'],
  ['manager', 'how is the team doing'],
  ['manager', 'i need a report'],
  ['manager', 'numbers'],
  ['manager', 'how many rooms did we do this week'],
  ['manager', 'who is my best worker'],
  ['manager', 'new starter'],
  ['manager', 'someone quit'],
  ['manager', 'is anna here'],
  ['manager', 'move anna to tomorrow'],

  // --- checker ---------------------------------------------------------
  ['checker', 'room not clean'],
  ['checker', 'what do i do'],
  ['checker', 'i finished checking'],
];

function firstLine(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > 190 ? `${t.slice(0, 190)}…` : t;
}

async function main() {
  const writesTriggered: string[] = [];
  const deadEnds: string[] = [];

  for (const [role, text] of PROMPTS) {
    const a = actor(role);
    const tools = visibleTools(a);

    try {
      const res = await provider.completeWithTools({
        system: buildSystemPrompt(a, tools, CONTEXT),
        messages: buildMessages(text),
        tools: tools.map(toolSpec),
      });

      const name = res.toolUse?.name ?? null;
      const reply = (res.text ?? '').trim();
      const tier = name ? (resolveTool(name)?.tier ?? '?') : null;

      let verdict: string;
      if (name) {
        verdict = `TOOL ${name} [${tier}] ${JSON.stringify(res.toolUse?.input ?? {})}`;
        // A vague message that reaches a WRITE is the thing most worth
        // seeing: the confirmation gate would catch it, but it should not
        // have been proposed.
        if (tier !== 'READ_ONLY') writesTriggered.push(`[${role}] "${text}" -> ${name}`);
      } else if (reply.length === 0) {
        verdict = 'DEAD END (no tool, no text)';
        deadEnds.push(`[${role}] "${text}"`);
      } else {
        verdict = `TEXT "${firstLine(reply)}"`;
      }

      console.log(`\n[${role}] "${text}"\n   ${verdict}`);
    } catch (error) {
      console.log(`\n[${role}] "${text}"\n   ERROR ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`\n\n=== ${PROMPTS.length} naive prompts ===`);
  console.log(`dead ends: ${deadEnds.length}`);
  deadEnds.forEach((d) => console.log(`   ${d}`));
  console.log(`\nvague prompts that proposed a WRITE: ${writesTriggered.length}`);
  writesTriggered.forEach((w) => console.log(`   ${w}`));
}

void main();
