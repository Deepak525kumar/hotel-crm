import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { chatbotActionRateLimit, chatbotTurnRateLimit } from './guardrails/rate-limit.js';
import {
  exchangeMessage,
  getConversation,
  invokeTool,
  listCommands,
  listTools,
  startConversation,
} from './controller.js';

const router = Router();

// Every route below is authenticated. The consent gate (RULE-CONSENT-01) is
// inherited by position from the v1 router — RULE-CONSENT-09 forbids a
// second gate, so none is added here.
router.use(authMiddleware);

// The tools this caller may use, filtered by their live permissions.
router.get('/tools', listTools);

// Direct tool invocation (no model in the loop). Deliberately NOT gated by
// requirePermission() at the route: a single route serves many tools with
// different permission tokens, so the check belongs where the tool is known
// — the executor re-checks the specific tool's token in-process against
// req.auth.permissions before anything runs.
//
// @requiresPermission staffing:read
router.post('/tools/invoke', chatbotActionRateLimit(), invokeTool);

// Conversation lifecycle. Self-scoped throughout: a conversation belongs to
// the worker who started it, and ownership is re-checked in the service and
// again in the orchestrator (RULE-CHAT-09).
router.post('/conversations', chatbotActionRateLimit(), startConversation);
// The metered path: this is the one that may reach the model, and the only
// one that can hold a connection for CHATBOT_TURN_TIMEOUT_MS. Limited per
// USER, not per IP -- see guardrails/rate-limit.ts for why that distinction
// matters on a shared office NAT. Complements the token budgets rather than
// duplicating them: they bound spend, this bounds rate.
router.post('/conversations/:id/messages', chatbotTurnRateLimit(), exchangeMessage);
router.get('/conversations/:id', getConversation);

// L0 command manifest — the client renders these as quick-reply chips. A
// tapped chip costs zero tokens.
router.get('/commands', listCommands);

export default router;
