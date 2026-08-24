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
      'my shifts',
      'my shift',
      'show my shifts',
      'what are my shifts',
      'when do i work',
      'my schedule',
      'show my schedule',
      'meine schichten',
      'mein dienstplan',
    ],
  },
  {
    id: 'my_upcoming_shifts',
    label: 'Upcoming shifts',
    tool: 'assignments.list_mine',
    args: { status: 'CONFIRMED' },
    phrases: [
      'upcoming shifts',
      'my upcoming shifts',
      'next shift',
      'my next shift',
      'what is my next shift',
      'naechste schicht',
    ],
  },
];

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BY_PHRASE = new Map<string, L0Command>();
const BY_ID = new Map<string, L0Command>();
for (const command of L0_COMMANDS) {
  BY_ID.set(command.id, command);
  for (const phrase of command.phrases) {
    BY_PHRASE.set(normalize(phrase), command);
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
