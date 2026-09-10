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


/**
 * Expected dates, computed the way the code computes them.
 *
 * They were hard-coded once, and the suite reported two failures the morning
 * after -- the Berlin date had rolled past midnight and the model's correct
 * answers no longer matched the frozen strings. A probe that pins a moment
 * instead of a rule fails for the calendar rather than for the code.
 */
const BERLIN = 'Europe/Berlin';
const isoOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: BERLIN }).format(d);
function fromToday(days: number): string {
  const parts = isoOf(new Date()).split('-').map(Number);
  const base = new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!, 12));
  return isoOf(new Date(base.getTime() + days * 86_400_000));
}
/** Monday of the week `offset` weeks from this one, and its Sunday. */
function weekRange(offsetWeeks: number): { from: string; to: string } {
  const parts = isoOf(new Date()).split('-').map(Number);
  const base = new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!, 12));
  const dow = base.getUTCDay();
  const monday = new Date(base.getTime() + (dow === 0 ? -6 : 1 - dow) * 86_400_000);
  const start = new Date(monday.getTime() + offsetWeeks * 7 * 86_400_000);
  return { from: isoOf(start), to: isoOf(new Date(start.getTime() + 6 * 86_400_000)) };
}
/** The next occurrence of a weekday, 0 = Sunday. */
function nextWeekday(target: number): string {
  for (let i = 1; i <= 7; i += 1) {
    const parts = fromToday(i).split('-').map(Number);
    if (new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!, 12)).getUTCDay() === target) {
      return fromToday(i);
    }
  }
  return fromToday(1);
}

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


  // ---- FOLLOW-UPS ------------------------------------------------------
  //
  // Everything above is a single turn. Real conversations are not: people ask
  // one thing and then refine it. The assistant replays the user's OWN prior
  // messages plus a structured label of the last action, and never tool
  // results (ADR-074 §5) -- so this measures whether that is ENOUGH to
  // resolve an ordinary follow-up, or whether the person has to repeat
  // themselves.
  // [role, what was said before, the follow-up, expected tool, expected args]
  //
  // THE ARGUMENTS ARE CHECKED, not just the tool. An earlier version compared
  // only the tool name and reported "OK" for two answers that were about the
  // wrong day: "what about saturday" came back with FRIDAY's date, and "and
  // last week" with THIS week's. A probe that cannot see that is worse than
  // no probe, because it certifies the bug.
  const FOLLOW_UPS: Array<[string, string[], string, string, Record<string, unknown>]> = [
    ['manager', ['whos working this week'], 'and next week?', 'assignments.list_for_my_team',
      weekRange(1)],
    ['manager', ['is anna free on friday'], 'what about saturday', 'calendar.check_availability',
      { day: nextWeekday(6) }],
    ['manager', ['who is off today'], 'and tomorrow', 'calendar.team_absences',
      { from: fromToday(1) }],
    ['worker', ['am i working tomorrow'], 'what about the day after', 'assignments.list_mine',
      { from: fromToday(2), to: fromToday(2) }],
    ['manager', ['show me last months attendance'], 'can i have that as a spreadsheet',
      'reports.export_team', { format: 'xlsx' }],
    ['worker', ['how many hours did i do this week'], 'and last week', 'attendance.my_hours',
      weekRange(-1)],
  ];

  console.log('\n--- follow-ups (second turn, with the first replayed) ---');
  let followOk = 0;
  for (const [role, history, followUp, expected, expectedArgs] of FOLLOW_UPS) {
    const a = actor(role);
    const tools = visibleTools(a);
    try {
      const res = await provider.completeWithTools({
        system: buildSystemPrompt(a, tools, CONTEXT),
        messages: buildMessages(followUp, history),
        tools: tools.map(toolSpec),
      });
      const tool = res.toolUse?.name ?? null;
      const args = (res.toolUse?.input ?? {}) as Record<string, unknown>;
      const wrongArgs = Object.entries(expectedArgs).filter(([k, v]) => args[k] !== v);
      const ok = tool === expected && wrongArgs.length === 0;
      if (ok) followOk += 1;
      console.log(`${ok ? 'OK  ' : 'MISS'} "${history[0]}" -> "${followUp}"`);
      console.log(`      got ${tool ?? '(no tool)'} ${JSON.stringify(args)}`);
      if (tool === expected && wrongArgs.length > 0) {
        console.log(`      !! wrong arguments: expected ${JSON.stringify(expectedArgs)}`);
      }
      if (!tool && res.text) console.log(`      text: "${firstLine(res.text)}"`);
    } catch (error) {
      console.log(`ERR  "${followUp}" ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`\n=== follow-ups: ${followOk}/${FOLLOW_UPS.length} kept the thread ===`);

  console.log(`\n=== ${PROBES.length} probes | ${deadEnds} dead ends | ${leaked} leaked tool names ===`);
}

void main();
