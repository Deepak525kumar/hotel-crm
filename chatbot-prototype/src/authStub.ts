// RULE-CHAT-09 self-scoping stand-in. The real module trusts auth-middleware's
// JWT verification; this prototype has no user/session system of its own, so
// it simulates "already-authenticated identity" via a required `x-worker-id`
// header — the analogue of `req.user.id` after real JWT verification.
//
// This is explicitly a test harness, not a security mechanism: anyone can set
// the header to any value. It exists only so ExchangeMessage/GetConversationOutcome
// can enforce and be tested against the self-scoping invariant the real
// auth-middleware would provide. Documented, not disguised as real auth.
import type { NextFunction, Request, Response } from "express";

const WORKER_ID_HEADER = "x-worker-id";
const WORKER_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export interface AuthedRequest extends Request {
  authenticatedWorkerId?: string;
}

export function requireWorkerIdentity(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.header(WORKER_ID_HEADER);
  if (!header || !WORKER_ID_PATTERN.test(header)) {
    res.status(401).json({ error: `missing or malformed ${WORKER_ID_HEADER} header (stub auth)` });
    return;
  }
  req.authenticatedWorkerId = header;
  next();
}
