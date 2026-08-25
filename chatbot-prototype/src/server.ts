// HTTP surface for local exploration and the qa/security test passes.
// Route shape mirrors SPEC-CHATBOT-001's Interfaces table with one deliberate
// deviation: IF-CHATBOT-StartConversation and GetConversationOutcome mode (b)
// are specified as in-process calls, never reachable by a worker's own
// client. Since this prototype has no real Onboarding caller to invoke them
// in-process, they're exposed under /internal/*, gated by a bearer token
// (config.internalCallerToken, printed at boot when generated) simulating
// "already an authenticated trusted caller" — a test harness, not a
// substitute for the real in-process trust boundary.
import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "./config.js";
import { requireWorkerIdentity, type AuthedRequest } from "./authStub.js";
import {
  startConversation,
  exchangeMessage,
  getConversationOutcome,
  getConversationOutcomeInProcess,
  refreshRequiredDocuments,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
  NotImplementedError,
} from "./conversationService.js";

const app = express();
app.use(express.json({ limit: "16kb" })); // body-size ceiling — defense-in-depth against oversized payloads

const CONVERSATION_ID = z.string().uuid();
const WORKER_ID = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);

const startConversationSchema = z.object({
  workerId: WORKER_ID,
  purpose: z.enum(["onboarding-document-collection", "gdpr-subject-rights"]),
  context: z
    .object({
      requiredDocuments: z
        .array(z.object({ name: z.string().trim().min(1).max(200), present: z.boolean() }))
        .max(50)
        .optional(),
      subjectRightsRequest: z.unknown().optional(),
    })
    .default({}),
});

const exchangeMessageSchema = z
  .object({
    // No `submittedDocuments` field: a worker may never assert their own
    // document completeness. That determination is Documents' authority and
    // arrives via the trusted-tier /internal/.../refresh route below.
    message: z.string().min(1).max(4000),
  })
  .strict();

const refreshSchema = z.object({
  presentDocumentNames: z.array(z.string().max(200)).max(50),
});

function requireInternalCaller(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  const expected = config.internalCallerToken;
  const supplied = Buffer.from(token ?? "");
  const expectedBuf = Buffer.from(expected);
  const ok = supplied.length === expectedBuf.length && timingSafeEqual(supplied, expectedBuf);
  if (!ok) {
    res.status(401).json({ error: "missing or invalid internal caller token" });
    return;
  }
  next();
}

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, mockMode: config.mockMode, model: config.model });
});

// IF-CHATBOT-StartConversation (in-process, gated here as internal-only)
app.post("/internal/conversations", requireInternalCaller, async (req, res, next) => {
  try {
    const input = startConversationSchema.parse(req.body);
    const conversation = await startConversation(input);
    res.status(201).json(conversation);
  } catch (err) {
    next(err);
  }
});

// IF-CHATBOT-GetConversationOutcome, mode (b) (in-process, internal-only).
// Returns the narrowed outcome only — never the transcript.
app.get("/internal/conversations/:id", requireInternalCaller, (req, res, next) => {
  try {
    const id = CONVERSATION_ID.parse(req.params.id);
    const outcome = getConversationOutcomeInProcess(id);
    if (!outcome) {
      res.status(404).json({ error: "conversation not found" });
      return;
    }
    res.json(outcome);
  } catch (err) {
    next(err);
  }
});

// Trusted-tier completeness refresh — stands in for a real call into
// Documents' completeness interface. Deliberately NOT worker-facing.
app.post("/internal/conversations/:id/refresh", requireInternalCaller, (req, res, next) => {
  try {
    const id = CONVERSATION_ID.parse(req.params.id);
    const body = refreshSchema.parse(req.body);
    const conversation = refreshRequiredDocuments(id, body.presentDocumentNames);
    if (!conversation) {
      res.status(404).json({ error: "conversation not found" });
      return;
    }
    res.json(conversation);
  } catch (err) {
    next(err);
  }
});

// IF-CHATBOT-ExchangeMessage — direct end-user access, self-scoped (RULE-CHAT-09)
app.post("/conversations/:id/messages", requireWorkerIdentity, async (req: AuthedRequest, res, next) => {
  try {
    const id = CONVERSATION_ID.parse(req.params.id);
    const body = exchangeMessageSchema.parse(req.body);
    const conversation = await exchangeMessage(id, req.authenticatedWorkerId!, body.message);
    res.json(conversation);
  } catch (err) {
    next(err);
  }
});

// IF-CHATBOT-GetConversationOutcome, mode (a) — direct, self-scoped worker poll
app.get("/conversations/:id", requireWorkerIdentity, (req: AuthedRequest, res, next) => {
  try {
    const id = CONVERSATION_ID.parse(req.params.id);
    res.json(getConversationOutcome(id, req.authenticatedWorkerId!));
  } catch (err) {
    next(err);
  }
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) {
    // Path and code only — never echo `received`, which reflects caller input.
    res.status(400).json({
      error: "validation failed",
      issues: err.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })),
    });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof ForbiddenError) {
    res.status(403).json({ error: err.message });
    return;
  }
  if (err instanceof ConflictError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof RateLimitError) {
    res.status(429).json({ error: err.message });
    return;
  }
  if (err instanceof NotImplementedError) {
    res.status(501).json({ error: err.message });
    return;
  }
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: "internal error" });
});

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`chatbot-prototype listening on :${config.port} (mockMode=${config.mockMode})`);
    if (config.internalCallerTokenWasGenerated) {
      // Printed only for the ephemeral dev-generated token. An operator-supplied
      // INTERNAL_CALLER_TOKEN is never echoed to the boot log.
      // eslint-disable-next-line no-console
      console.log(`generated internal caller token (dev only): ${config.internalCallerToken}`);
    }
  });
}

export { app };
