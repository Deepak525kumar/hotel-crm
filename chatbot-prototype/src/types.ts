// Proposed ChatbotConversation shape — SPEC-CHATBOT-001 §"State and Lifecycle".
// Name/shape are explicitly disclosed as unratified (OD-CHAT-001).

export type Purpose = "onboarding-document-collection" | "gdpr-subject-rights";

export type Outcome = "in-progress" | "completed" | "fallback-triggered";

export type FallbackReason =
  | "monthly-budget-exhausted"
  | "conversation-limit-exceeded"
  | "provider-unavailable"
  | "turn-limit-exceeded";

export type RiskTier = "read-only" | "low-risk-write" | "high-risk-write";

export interface RequiredDocument {
  name: string;
  present: boolean;
}

export interface ConversationMessage {
  role: "system" | "worker" | "agent";
  content: string;
  timestamp: string;
}

export interface ToolCallLogEntry {
  /** Short id the worker must reference to confirm — a bare "confirm" is not enough. */
  id: string;
  tool: string;
  input: unknown;
  output: unknown;
  riskTier: RiskTier;
  confirmed: boolean;
  /** Turn number after which a pending confirmation is no longer honoured. */
  pendingUntilTurn?: number;
  expired?: boolean;
  timestamp: string;
}

export interface TokenSpend {
  promptTokens: number;
  completionTokens: number;
  total: number;
}

export interface ChatbotConversation {
  id: string;
  workerId: string;
  purpose: Purpose;
  status: Outcome;
  fallbackReason?: FallbackReason;
  model: string;
  requiredDocuments?: RequiredDocument[];
  messages: ConversationMessage[];
  toolCallLog: ToolCallLogEntry[];
  tokenSpend: TokenSpend;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Narrowed outcome returned across module boundaries — no transcript. */
export interface ConversationOutcome {
  id: string;
  status: Outcome;
  fallbackReason?: FallbackReason;
}

export interface StartConversationInput {
  workerId: string;
  purpose: Purpose;
  context: {
    requiredDocuments?: RequiredDocument[];
    subjectRightsRequest?: unknown;
  };
}
