/**
 * L0 — the deterministic command router. **Zero LLM calls.**
 *
 * This is the highest-leverage piece of the whole cost model, and it is a
 * product decision rather than a model decision: the high-frequency intents
 * in a workforce app ("my shifts", "my documents", "clock in") are finite and
 * enumerable. Rendered as quick-reply chips in the client, a tapped chip is a
 * command is a direct tool call at zero token cost.
 *
 * It also happens to be the safest path in the system: there is no model
 * output to distrust, because there is no model. The same executor gate still
 * runs — an L0 command is not a bypass, it is a cheaper way to reach the same
 * boundary.
 *
 * Matching is deliberately conservative. A phrase that is not an exact,
 * unambiguous match falls through to L1 rather than guessing — a wrong L0
 * match would silently answer a question the worker did not ask, which is
 * worse than spending a token on getting it right.
 */

import { resolveTool } from '../tools/registry.js';
import { actorHasPermission } from '../tools/executor.js';
import type { ActorContext } from '../tools/actor.js';

export interface L0Command {
  /** Stable id the client sends when a chip is tapped. */
  id: string;
  /** Chip label. Client-facing; not used for matching. */
  label: string;
  /** The tool this resolves to. */
  tool: string;
  /** Fixed arguments — never taken from user text (nothing to parse, nothing to inject). */
  args: Record<string, unknown>;
  /**
   * Exact phrases that resolve here. Compared after normalization
   * (lowercased, punctuation stripped, whitespace collapsed).
   */
  phrases: string[];
}

export const L0_COMMANDS: readonly L0Command[] = [
  // ---- MANAGERS ---------------------------------------------------------
  //
  // There were none. Every one of the eight commands below this block is a
  // worker's own record, so a hotel manager opening the assistant was shown
  // chips for payslips and cleaned rooms and nothing at all for running a
  // shift -- and their three commonest questions each cost a model call, a
  // second of latency and a slice of the token budget, to reach a tool that
  // takes no arguments and could have answered instantly.
  //
  // Zero arguments each, deliberately: these answer "today", which is what
  // the question means when someone taps a button rather than typing. A
  // period is a typed question, and L1 handles it.
  {
    id: 'team_today',
    label: "Who's on today",
    tool: 'assignments.list_for_my_team',
    args: {},
    phrases: [
      'who is on today',
      'whos on today',
      'who is working today',
      'whos working today',
      'who is scheduled today',
      'team today',
      'wer arbeitet heute',
      'wer ist heute eingeteilt',
    ],
  },
  {
    id: 'team_clocked_in',
    label: 'Who has clocked in',
    tool: 'attendance.team_status',
    args: {},
    phrases: [
      'who has clocked in',
      'whos clocked in',
      'who has checked in',
      'is everyone in',
      'is everyone here',
      'who is missing',
      'wer ist heute da',
      'wer hat eingestempelt',
      'hat jemand nicht eingestempelt',
    ],
  },
  {
    id: 'team_off',
    label: "Who's off",
    tool: 'calendar.team_absences',
    args: {},
    phrases: [
      'who is off',
      'whos off',
      'who is off today',
      'who called in sick',
      'whos sick',
      'who is sick today',
      'wer ist heute krank',
      'wer hat urlaub',
      'wer fehlt heute',
    ],
  },

  {
    id: 'my_payslips',
    label: 'My payslips',
    tool: 'hr.my_payslips',
    args: {},
    phrases: [
      'my payslips',
      'my payslip',
      'have i got my payslip',
      'did i get my payslip',
      'my payslip requests',
      'meine lohnabrechnung',
      'meine gehaltsabrechnung',
      'habe ich meine lohnabrechnung',
    ],
  },
  {
    id: 'my_inspections',
    label: 'My inspections',
    tool: 'quality.my_inspections',
    args: {},
    phrases: [
      'my inspections',
      'my checks',
      'what did i inspect',
      'my inspection history',
      'meine kontrollen',
      'meine pruefungen',
    ],
  },
  {
    id: 'my_contract',
    label: 'My contract',
    tool: 'hr.my_contract',
    args: {},
    phrases: [
      'my contract',
      'my contract status',
      'when does my contract end',
      'when does my contract expire',
      'am i permanent',
      'show my contract',
      'mein vertrag',
      'mein vertragsstatus',
      'wann endet mein vertrag',
      'wann laeuft mein vertrag aus',
    ],
  },
  {
    id: 'my_documents',
    label: 'My documents',
    tool: 'documents.my_status',
    args: {},
    // The most-asked onboarding question, and the one whose asker is least
    // able to navigate a checklist UI -- so it earns an L0 entry, answered
    // deterministically at zero token cost. German phrases are stored in
    // FOLDED form (ae/oe/ue/ss), matching every other command here, because
    // folding is applied to the input before comparison.
    phrases: [
      'my documents',
      'my document status',
      'what documents do i need',
      'which documents do i need',
      'what documents are missing',
      'which documents are missing',
      'am i missing any documents',
      'are my documents complete',
      'meine unterlagen',
      'meine dokumente',
      'welche unterlagen fehlen',
      'welche unterlagen fehlen noch',
      'welche dokumente fehlen',
      'fehlen noch unterlagen',
      'sind meine unterlagen vollstaendig',
    ],
  },
  {
    // Added with `attendance.my_hours` (2026-09-10). Hours are what people
    // are paid for, so this is asked constantly -- and it was reaching the
    // model every time.
    id: 'my_hours',
    label: 'My hours',
    tool: 'attendance.my_hours',
    args: {},
    phrases: [
      'my hours',
      'how many hours have i worked',
      'how many hours did i work',
      'hours worked',
      'meine stunden',
      'wie viele stunden habe ich gearbeitet',
    ],
  },
  {
    id: 'my_rooms',
    label: 'My rooms today',
    tool: 'rooms.my_rooms',
    args: {},
    // Asked constantly mid-shift, and free to answer. German phrases in the
    // folded form the matcher uses (ae/oe/ue/ss).
    phrases: [
      'my rooms',
      'my rooms today',
      'how many rooms have i done',
      'how many rooms did i do',
      'which rooms did i log',
      'meine zimmer',
      'wie viele zimmer habe ich geschafft',
      'wie viele zimmer habe ich gemacht',
    ],
  },
  {
    id: 'my_notifications',
    label: 'My messages',
    tool: 'notifications.list_mine',
    args: {},
    phrases: [
      // English
      'my notifications',
      'my messages',
      'do i have any messages',
      'do i have any notifications',
      'any updates for me',
      'any news for me',
      'show my notifications',
      'show my messages',
      // German
      'meine nachrichten',
      'meine benachrichtigungen',
      'habe ich nachrichten',
      'gibt es neuigkeiten',
      'zeig meine nachrichten',
    ],
  },
  {
    id: 'my_shifts',
    label: 'My shifts',
    tool: 'assignments.list_mine',
    args: {},
    phrases: [
      // English
      'my shifts',
      'my shift',
      'show my shifts',
      'show me my shifts',
      'what are my shifts',
      'when do i work',
      'when am i working',
      'what am i working',
      'my schedule',
      'show my schedule',
      'my work schedule',
      'my roster',
      'my assignments',
      'show my assignments',
      // German. Umlaut and ae/oe/ue spellings fold to the same key in
      // normalize(), so only ONE spelling of each phrase belongs here --
      // listing both would be dead weight, not extra coverage.
      'meine schichten',
      'meine schicht',
      'zeig meine schichten',
      'zeige meine schichten',
      'meine dienste',
      'mein dienstplan',
      'mein schichtplan',
      'schichtplan',
      'arbeitsplan',
      'wann arbeite ich',
    ],
  },
  {
    id: 'my_upcoming_shifts',
    label: 'Upcoming shifts',
    tool: 'assignments.list_mine',
    args: { status: 'CONFIRMED' },
    phrases: [
      // English
      'upcoming shifts',
      'my upcoming shifts',
      'next shift',
      'my next shift',
      'what is my next shift',
      'when is my next shift',
      'confirmed shifts',
      'my confirmed shifts',
      // German
      'naechste schicht',
      'meine naechste schicht',
      'wann ist meine naechste schicht',
      'naechster dienst',
      'kommende schichten',
      'bestaetigte schichten',
    ],
  },
];

/**
 * German transliteration, applied BEFORE decomposition.
 *
 * The platform's workforce is German-speaking, so this is the common case,
 * not an edge case. `ae`/`oe`/`ue`/`ss` is the standard convention a German
 * typist falls back to without an umlaut key, so folding both spellings to
 * the same key makes "nächste" and "naechste" one phrase rather than two.
 */
const GERMAN_FOLDING: ReadonlyArray<readonly [RegExp, string]> = [
  [/ä/g, 'ae'],
  [/ö/g, 'oe'],
  [/ü/g, 'ue'],
  [/ß/g, 'ss'],
];

/**
 * Lowercase, fold German umlauts, strip diacritics, strip punctuation,
 * collapse whitespace.
 *
 * The combining-mark step is NOT cosmetic. This previously ran `NFKD` and
 * then replaced every non-letter/non-digit with a SPACE -- and `NFKD` splits
 * "ä" into "a" plus U+0308 COMBINING DIAERESIS, which is Unicode category
 * Mn (Mark), not L. So the mark became a space and "nächste schicht"
 * normalized to "na chste schicht", matching no phrase at all. Every German
 * worker typing the natural spelling of an umlaut word fell through to L1 --
 * which is not built -- while `'Meine Schichten'`, the one German phrase
 * under test, has no umlaut and passed.
 *
 * Marks are therefore REMOVED rather than replaced with a separator, so a
 * decomposed character collapses back to one word instead of two.
 */
export function normalize(input: string): string {
  let text = input.toLowerCase();
  for (const [pattern, replacement] of GERMAN_FOLDING) {
    text = text.replace(pattern, replacement);
  }
  return text
    .normalize('NFKD')
    // Combining marks first, and dropped -- not turned into a separator.
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BY_PHRASE = new Map<string, L0Command>();
const BY_ID = new Map<string, L0Command>();
for (const command of L0_COMMANDS) {
  if (BY_ID.has(command.id)) {
    throw new Error(`L0: duplicate command id "${command.id}"`);
  }
  BY_ID.set(command.id, command);

  for (const phrase of command.phrases) {
    const key = normalize(phrase);
    const existing = BY_PHRASE.get(key);
    // A phrase claimed by two commands is silently won by whichever is
    // declared last, which would route a worker's question to the wrong tool
    // with no error anywhere -- the exact "confidently answer the question
    // nobody asked" failure this router is built to avoid. Two spellings of
    // one phrase (umlaut vs. ae) now normalize to ONE key, so this also
    // catches a redundant entry added out of habit.
    if (existing && existing.id !== command.id) {
      throw new Error(
        `L0: phrase "${phrase}" (normalized "${key}") is claimed by both "${existing.id}" and "${command.id}"`
      );
    }
    if (existing) {
      throw new Error(`L0: duplicate phrase "${phrase}" (normalized "${key}") in "${command.id}"`);
    }
    BY_PHRASE.set(key, command);
  }
}

/**
 * INTENTS: questions whose MEANING is fixed but whose wording is not.
 *
 * Added 2026-09-15 for one question, asked by the owner in real use and then
 * put to the live model: "give me record data previews weeks how much work we
 * did". In a full conversation the model called the work summary; sent on its
 * own it answered in prose, twice, across routing runs. A question this
 * common should not depend on how a model reads a misspelling -- and "how
 * much work did we do" has exactly one reading and no arguments to extract.
 *
 * An exact phrase could not cover it: nobody types the same sentence twice.
 * So an intent requires SEVERAL signals together, and steps aside rather than
 * guess:
 *
 *   - wording that asks about work done ("how much work", "record data",
 *     "wie viel ... geschafft");
 *   - wording about the TEAM ("we", "our", "team", "wir"), so "how much work
 *     did I do" is left to the self-service tools;
 *   - and NO date, period or number at all. "last month", "07.09.2026",
 *     "im August" carry an argument this router cannot parse, so those go to
 *     the model, which reads dates. Without one, the tool's own default (the
 *     last two weeks, stated in the answer) is the right reading.
 *
 * The orchestrator uses a text match only when the person holds the tool's
 * permission, so a worker asking this falls through to the model instead of
 * meeting "You do not have access to that."
 */
interface L0Intent {
  command: L0Command;
  matches: (normalized: string) => boolean;
}

const WORK_QUESTION =
  /\b(how much work|how much did we|how much have we|how many shifts|record data|work data|work record|arbeitsdaten|wie ?viel(e)? (arbeit|haben wir|habt ihr)|was haben wir geschafft)\b/;
const TEAM_WORDS = /\b(we|our|us|team|everyone|everybody|wir|unser|unsere|alle)\b/;
const PERIOD_OR_DATE =
  /\d|\b(today|yesterday|tomorrow|tonight|last|this|next|past|since|until|between|month|months|year|years|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|heute|gestern|morgen|letzte|letzten|letzter|diese|dieser|diesen|naechste|naechsten|seit|bis|monat|monate|jahr|januar|februar|maerz|mai|juni|juli|oktober|dezember|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/;

const CHAT_WORDS = /\b(chats?|conversations?|gespraeche?|unterhaltungen?|verlauf)\b/;
const EARLIER_WORDS = /\b(previous|old|older|earlier|past|history|alte[nr]?|fruehere[nr]?|vorherige[nr]?|verlauf)\b/;

export const L0_INTENTS: readonly L0Intent[] = [
  {
    command: {
      id: 'intent_work_summary',
      label: 'How much work we did',
      tool: 'reports.work_summary',
      // No arguments: the tool's default range is the last two weeks, and it
      // names the dates in its answer.
      args: {},
      phrases: [],
    },
    matches: (text) => WORK_QUESTION.test(text) && TEAM_WORDS.test(text) && !PERIOD_OR_DATE.test(text),
  },
  /**
   * "I want previous chats". Sent alone it routes to the history tool; in the
   * owner's own conversation, replayed word for word (2026-09-15), the model
   * answered in prose -- "Here are your previous chats from the last 30 days"
   * -- and listed nothing, because it had fetched nothing. No arguments, one
   * reading, so it does not go to the model at all. A date ("what did I ask
   * yesterday") still goes to the model, which reads dates.
   */
  {
    command: {
      id: 'intent_recent_conversations',
      label: 'Previous chats',
      tool: 'chatbot.recent_conversations',
      args: {},
      phrases: [],
    },
    matches: (text) => CHAT_WORDS.test(text) && EARLIER_WORDS.test(text) && !PERIOD_OR_DATE.test(text),
  },
];

/**
 * Exact phrase first, then an intent. Returns undefined so the caller
 * escalates to L1.
 */
export function matchL0(text: string): L0Command | undefined {
  if (typeof text !== 'string') return undefined;
  const normalized = normalize(text);
  return BY_PHRASE.get(normalized) ?? L0_INTENTS.find((intent) => intent.matches(normalized))?.command;
}

/** Chip tap / slash command: resolves by id, no text parsing at all. */
export function resolveCommandId(id: string): L0Command | undefined {
  if (typeof id !== 'string') return undefined;
  return BY_ID.get(id);
}

/** The manifest the client renders as quick-reply chips. */
export function commandManifest(
  actor?: ActorContext
): Array<{ id: string; label: string; tool: string }> {
  // FILTERED BY WHAT THIS PERSON CAN ACTUALLY USE.
  //
  // The manifest used to return every command to everyone. That was harmless
  // only for as long as every command happened to be a self-service tool that
  // every role holds -- the moment a manager-scoped chip existed, a worker
  // would have been shown a button whose only possible answer is "You do not
  // have access to that." Offering someone a control that refuses them is a
  // worse failure than not offering it at all.
  //
  // Checked against the SAME permission the executor enforces, so the chips a
  // person sees and the calls that will actually succeed cannot drift apart.
  // Called without an actor it returns everything, as before.
  const visible = actor
    ? L0_COMMANDS.filter((c) => {
        const tool = resolveTool(c.tool);
        if (!tool) return false;
        return tool.permission === null || actorHasPermission(actor, tool.permission);
      })
    : L0_COMMANDS;

  return visible.map((c) => ({ id: c.id, label: c.label, tool: c.tool }));
}
