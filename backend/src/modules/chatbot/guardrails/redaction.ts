/**
 * Egress redaction — applied to every tool result BEFORE it can reach a
 * prompt, and to anything persisted in `session_state`.
 *
 * The rule this enforces: the model may learn WHETHER a sensitive value
 * exists, never WHAT it is. `tax_number: "12 345 678 901"` becomes
 * `has_tax_number: true`. There is no product requirement anywhere in CRR/PDD
 * for the model to read a Sozialversicherungsnummer, so it never sees one —
 * not even for an Admin, because a role that is allowed to view a value in
 * the UI is a different question from whether that value should cross into a
 * third-party inference call.
 *
 * `employees:special_category:read` is Admin-only in ROLE_PERMISSIONS, and
 * DocumentCategory includes TAX_NUMBER and SOCIAL_SECURITY_NUMBER (CRR §27
 * special-category fields). This list is deliberately broader than that
 * enum — it also covers the field names those values arrive under.
 */

/** Field names whose VALUE must never reach a model. */
const SENSITIVE_FIELD_PATTERNS: RegExp[] = [
  /tax[_-]?(number|id)/i,
  /social[_-]?security/i,
  /sozialversicherung/i,
  /steuer(nummer|id)/i,
  /\biban\b/i,
  /\bbic\b/i,
  /bank[_-]?account/i,
  /passport[_-]?number/i,
  /id[_-]?card[_-]?number/i,
  /konfession|religion/i,
  /disabilit|schwerbehind/i,
  /health|medical|diagnos/i,
  /password|secret|token|api[_-]?key/i,
  /date[_-]?of[_-]?birth|\bdob\b|geburtsdatum/i,
];

/** Field names that are themselves fine to pass through untouched. */
const ALWAYS_SAFE = new Set(['id', 'status', 'day', 'hotel_id', 'worker_id', 'summary']);

export function isSensitiveField(name: string): boolean {
  if (ALWAYS_SAFE.has(name)) return false;
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Recursively replaces sensitive values with a presence boolean.
 *
 * Depth-bounded: a tool result is a compressed DTO, not an object graph, and
 * an unbounded walk over a cyclic structure would hang the turn.
 */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveField(key)) {
      // Presence, never content. `has_x: false` for an absent value is as
      // informative as the model needs and leaks nothing.
      out[`has_${key}`] = val !== null && val !== undefined && val !== '';
      continue;
    }
    out[key] = redact(val, depth + 1);
  }
  return out as T;
}
