// RULE-CHAT-10 / REQ-CHAT-014 — conversation-level audit entries (start,
// completion, fallback). Stands in for base-service's logAudit/AuditLog
// pattern; the real implementation would reuse that shared table instead of
// stdout, since this is deliberately not wired to the real backend.
//
// Tool-invocation events go beyond RULE-CHAT-10's lifecycle scope on purpose:
// ADR-053 gates irreversible actions behind confirmation, and a confirmation
// gate with no durable record of what was confirmed is not reconstructable
// when a worker later disputes an action taken "by the assistant".
export type AuditEvent =
  | "conversation-started"
  | "conversation-completed"
  | "fallback-triggered"
  | "tool-invoked"
  | "tool-confirmed"
  | "tool-refused";

export interface AuditEntry {
  event: AuditEvent;
  conversationId: string;
  workerId: string;
  purpose: string;
  outcome?: string;
  tool?: string;
  riskTier?: string;
  /** Field NAMES only — never values, which may carry PII. */
  inputFields?: string[];
  timestamp: string;
}

const entries: AuditEntry[] = [];

export const auditLog = {
  record(entry: AuditEntry): void {
    entries.push(entry);
    // eslint-disable-next-line no-console
    console.log(`[audit] ${entry.event}`, JSON.stringify(entry));
  },
  all(): AuditEntry[] {
    return entries.slice();
  },
  __resetForTests(): void {
    entries.length = 0;
  },
};
