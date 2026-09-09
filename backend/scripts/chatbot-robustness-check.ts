/**
 * LIVE robustness probe — what a real person actually types.
 *
 * The routing check asks "given a clean phrasing, is the right tool chosen?".
 * This asks the harder question the production transcript of 2026-09-10 made
 * unavoidable: what happens when somebody types the way people type -- with
 * typos, without context, in half a sentence, or about something the
 * assistant cannot do at all.
 *
 * It has no pass/fail baked in for most cases, because "the right answer" to
 * "hi" is a judgement, not an assertion. It PRINTS what each input produces
 * so a human can see the dead ends. The few real assertions are marked.
 *
 *   cd backend && npx tsx scripts/chatbot-robustness-check.ts
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
  hotels: ['hotel_1_group_1', 'Premier Inn Essen City Centre Hotel'],
};

/**
 * [role, what they typed, why this case is here]
 *
 * WRITTEN AS ORDINARY PEOPLE TYPE, deliberately. The users here are cleaners,
 * checkers and hotel managers, mostly on a phone, mostly mid-shift, many
 * working in German, and almost none of themuse AI regularly. They do not
 * write "list my assignments for 2026-09-11"; they write "when do i work
 * next" with no capitals and no question mark.
 *
 * So: no keywords, no field names, no dates in ISO, plenty of typos, and
 * several messages that are not questions at all.
 */
const PROBES: Array<[string, string, string]> = [
  // ============ WORKER (a cleaner, on a phone, mid-shift) ================
  ['worker', 'when do i work next', 'the single commonest question'],
  ['worker', 'am i working tomorrow', 'needs a date filter to be right'],
  ['worker', 'do i work on saturday', 'named weekday, no date'],
  ['worker', 'where am i working today', 'location, not schedule'],
  ['worker', 'im here', 'arriving = clock in'],
  ['worker', 'im off now', 'leaving = clock out'],
  ['worker', 'finished room 12', 'no verb, room number'],
  ['worker', 'i cant come in tomorrow im sick', 'sick leave, plain speech'],
  ['worker', 'i need friday off', 'holiday request'],
  ['worker', 'how many hours did i do this week', 'hours, not shifts'],
  ['worker', 'did i get paid yet', 'payroll, vague'],
  ['worker', 'i need my payslip', 'payslip'],
  ['worker', 'whats my contract say', 'contract'],
  ['worker', 'do i need to bring anything', 'documents, indirect'],
  ['worker', 'any messages for me', 'notifications'],
  ['worker', 'wann arbeite ich wieder', 'German, plain'],
  ['worker', 'ich bin krank', 'German, sick'],
  ['worker', 'zimmer 12 ist fertig', 'German, room done'],

  // ============ CHECKER (quality inspections) ===========================
  ['checker', 'what do i need to check today', 'inspection queue'],
  ['checker', 'room 12 is not clean enough', 'rework, plain speech'],
  ['checker', 'show me what i checked', 'own inspections'],

  // ============ MANAGER (running a hotel, not technical) ================
  ['manager', 'is everyone in today', 'attendance, indirect'],
  ['manager', 'who called in sick', 'absence, indirect'],
  ['manager', 'i need someone for saturday morning', 'staffing request'],
  ['manager', 'put anna on tomorrow', 'placement, plain'],
  ['manager', 'anna is off sick today', 'mark absence'],
  ['manager', 'how many people do i have', 'roster size'],
  ['manager', 'is anna free on friday', 'availability'],
  ['manager', 'whos working this week', 'schedule, whole week'],
  ['manager', 'send me last months numbers', 'report, vague'],
  ['manager', 'i need it as a spreadsheet', 'format-only follow-up'],
  ['manager', 'wer ist heute krank', 'German, who is sick'],
  ['manager', 'hat jemand nicht eingestempelt', 'German, who did not clock in'],
];

function firstLine(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > 150 ? `${t.slice(0, 150)}…` : t;
}

async function main() {
  let leaked = 0;
  let deadEnds = 0;

  for (const [role, phrase, why] of PROBES) {
    const a = actor(role);
    const tools = visibleTools(a);
    const toolNames = tools.map((t) => t.name);

    try {
      const res = await provider.completeWithTools({
        system: buildSystemPrompt(a, tools, CONTEXT),
        messages: buildMessages(phrase),
        tools: tools.map(toolSpec),
      });

      const tool = res.toolUse?.name ?? null;
      const text = res.text ?? '';
      const namesInText = toolNames.filter((n) => text.includes(n));
      if (namesInText.length > 0) leaked += 1;
      // A dead end: no tool ran AND the model said nothing useful, so the
      // user gets renderUnrecognized() -- "I did not understand that."
      if (!tool && text.trim().length === 0) deadEnds += 1;

      const verdict = tool
        ? `TOOL ${tool} ${JSON.stringify(res.toolUse?.input ?? {})}`
        : text.trim().length === 0
          ? 'DEAD END (no tool, no text -> "I did not understand that")'
          : `TEXT "${firstLine(text)}"`;

      console.log(`\n[${role}] "${phrase}"   (${why})`);
      console.log(`   ${verdict}`);
      if (namesInText.length > 0) console.log(`   !! LEAKED TOOL NAMES: ${namesInText.join(', ')}`);
    } catch (error) {
      console.log(`\n[${role}] "${phrase}"`);
      console.log(`   ERROR ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`\n=== ${PROBES.length} probes | ${deadEnds} dead ends | ${leaked} leaked tool names ===`);
}

void main();
