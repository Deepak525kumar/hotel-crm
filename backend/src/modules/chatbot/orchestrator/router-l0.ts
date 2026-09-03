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

/** Exact-phrase match only. Returns undefined so the caller escalates to L1. */
export function matchL0(text: string): L0Command | undefined {
  if (typeof text !== 'string') return undefined;
  return BY_PHRASE.get(normalize(text));
}

/** Chip tap / slash command: resolves by id, no text parsing at all. */
export function resolveCommandId(id: string): L0Command | undefined {
  if (typeof id !== 'string') return undefined;
  return BY_ID.get(id);
}

/** The manifest the client renders as quick-reply chips. */
export function commandManifest(): Array<{ id: string; label: string; tool: string }> {
  return L0_COMMANDS.map((c) => ({ id: c.id, label: c.label, tool: c.tool }));
}
