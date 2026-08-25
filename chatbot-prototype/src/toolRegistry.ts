// ADR-053 — tool-registry architecture. Every executable capability the agent
// can invoke is registered here (target IF-* interface, schema, risk tier,
// confirmation requirement) rather than hardcoded into orchestration logic.
//
// Standalone-prototype note: the real integration would have each tool's
// `handler` call another module's actual IF-* interface (e.g. Documents'
// IF-DOC-UploadDocument), under that module's own RBAC — never touching a
// database directly (ADR-053 principle 3). Since this prototype is isolated
// from the rest of the backend, handlers below call small in-memory stubs
// standing in for those interfaces, clearly marked as such.
//
// Guardrail: model tool-use output is untrusted. `inputSchema` is the
// JSON-schema handed to Claude's tool-use API; `zodSchema` is the *runtime*
// gate every tool call is validated against before its handler ever runs —
// a model hallucinating an extra field, wrong type, or missing required
// field is rejected, not coerced.
import { z, type ZodTypeAny } from "zod";
import type { RequiredDocument, RiskTier } from "./types.js";

export interface ToolDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  riskTier: RiskTier;
  requiresConfirmation: boolean; // mandatory=true for high-risk-write (ADR-053 principle 5)
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  }; // JSON-schema-shaped, passed to Claude's tool-use API
  zodSchema: ZodTypeAny; // runtime validation gate — the actual trust boundary
  handler: (input: TInput, ctx: ToolContext) => Promise<TOutput> | TOutput;
}

export interface ToolContext {
  workerId: string;
  requiredDocuments: RequiredDocument[];
}

// RULE-CHAT-09: a tool's actor scope MUST derive from ToolContext (which the
// conversation record supplies from the trusted side), never from a parameter
// the model can be steered into filling. A schema key naming an identity is
// the shape an IDOR takes in a tool-calling agent, so it is refused at
// registration rather than left to reviewer vigilance.
const IDENTITY_PARAM_PATTERN = /^(worker|user|employee|site|hotel|account|actor|tenant|org)_?id$/i;

function assertNoIdentityParameters(def: ToolDefinition<any, any>): void {
  const keys = Object.keys(def.inputSchema.properties ?? {});
  const offending = keys.filter((key) => IDENTITY_PARAM_PATTERN.test(key));
  if (offending.length > 0) {
    throw new Error(
      `Tool "${def.name}" declares identity parameter(s) [${offending.join(", ")}]. ` +
        `Actor scope must come from ToolContext, never from model-supplied input (RULE-CHAT-09).`,
    );
  }
}

function defineTool<TInput, TOutput>(def: ToolDefinition<TInput, TOutput>): ToolDefinition<TInput, TOutput> {
  if (def.riskTier === "high-risk-write" && !def.requiresConfirmation) {
    // ADR-053 principle 5: confirmation is mandatory for high-risk/irreversible
    // writes regardless of what the tool author requested at registration.
    throw new Error(`Tool "${def.name}" is high-risk-write and must require confirmation`);
  }
  assertNoIdentityParameters(def);
  return def;
}

/** Exported so tests can assert the registration invariants actually reject bad tools. */
export const __defineToolForTests = defineTool;

const DOCUMENT_NAME = z.string().trim().min(1).max(200);

const getDocumentStatus = defineTool<{ documentName: string }, { documentName: string; present: boolean } | null>({
  name: "get_document_status",
  description: "Check whether a specific required document has already been submitted, from the completeness context supplied at conversation start.",
  riskTier: "read-only",
  requiresConfirmation: false,
  inputSchema: {
    type: "object",
    properties: { documentName: { type: "string" } },
    required: ["documentName"],
  },
  zodSchema: z.object({ documentName: DOCUMENT_NAME }).strict(),
  handler: (input, ctx) => {
    const match = ctx.requiredDocuments.find((doc) => doc.name.toLowerCase() === input.documentName.toLowerCase());
    return match ? { documentName: match.name, present: match.present } : null;
  },
});

const confirmDocumentFormat = defineTool<{ documentName: string; statedFormat: string }, { acknowledged: true }>({
  name: "confirm_document_format",
  description: "Record the worker's stated file type/format for a document as a lightweight conversational hint (not byte-level validation — that belongs to Documents).",
  riskTier: "low-risk-write",
  requiresConfirmation: false,
  inputSchema: {
    type: "object",
    properties: {
      documentName: { type: "string" },
      statedFormat: { type: "string" },
    },
    required: ["documentName", "statedFormat"],
  },
  zodSchema: z
    .object({ documentName: DOCUMENT_NAME, statedFormat: z.string().trim().min(1).max(50) })
    .strict(),
  handler: () => {
    // Stub for a future IF-DOC-* hint-recording call. Isolated: no real write.
    return { acknowledged: true };
  },
});

const flagForManualReview = defineTool<{ reason: string }, { flagged: true; reason: string }>({
  name: "flag_for_manual_review",
  description: "Escalate this conversation out of the automated flow into manual/human onboarding handling. Irreversible from the conversation's perspective — always confirm with the worker first.",
  riskTier: "high-risk-write",
  requiresConfirmation: true,
  inputSchema: {
    type: "object",
    properties: { reason: { type: "string" } },
    required: ["reason"],
  },
  zodSchema: z.object({ reason: z.string().trim().min(1).max(500) }).strict(),
  handler: (input) => {
    // Stub for a future in-process call into Onboarding's own workflow.
    return { flagged: true, reason: input.reason };
  },
});

// Null-prototype: `resolveTool` indexes this with model-controlled strings, so
// a plain object literal would make inherited members ("constructor",
// "__proto__", "toString", …) resolve truthy and slip past the allow-list check.
export const TOOL_REGISTRY: Record<string, ToolDefinition> = Object.assign(Object.create(null), {
  [getDocumentStatus.name]: getDocumentStatus,
  [confirmDocumentFormat.name]: confirmDocumentFormat,
  [flagForManualReview.name]: flagForManualReview,
});

export function listToolsForClaude() {
  return Object.values(TOOL_REGISTRY).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

export function resolveTool(name: string): ToolDefinition | undefined {
  // Allow-listed lookup only — a tool name the model invents that isn't an OWN
  // key of TOOL_REGISTRY resolves to undefined and is refused by the caller.
  // The hasOwn check is belt-and-braces alongside the null prototype above.
  if (typeof name !== "string" || !Object.hasOwn(TOOL_REGISTRY, name)) return undefined;
  return TOOL_REGISTRY[name];
}

export type ToolValidation = { ok: true; input: unknown } | { ok: false; error: string };

/** Runtime trust boundary: model-supplied tool input is never passed to a handler unvalidated. */
export function validateToolInput(tool: ToolDefinition, rawInput: unknown): ToolValidation {
  const result = tool.zodSchema.safeParse(rawInput);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => i.message).join("; ") };
  }
  return { ok: true, input: result.data };
}
