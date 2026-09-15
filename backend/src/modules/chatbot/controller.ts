import { Request, Response, NextFunction } from 'express';
import { ERROR_CODES } from '../../config/constants.js';
import { ForbiddenError, ValidationError } from '../../lib/errors.js';
import { sendSuccess } from '../../lib/http-envelope.js';
import { actorFromRequest } from './tools/actor.js';
import { chatbotService } from './service.js';
import { ExchangeMessageSchema, InvokeToolSchema, StartConversationSchema } from './types.js';
import { commandManifest } from './orchestrator/router-l0.js';

function zodDetails(error: import('zod').ZodError) {
  return error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }));
}

/**
 * Direct tool invocation — the AI-free path.
 *
 * This exists so the authorization boundary can be exercised end to end
 * (real JWT, real permissions, real services, real database) before any
 * model is wired. When the orchestrator lands, it calls the same
 * `chatbotService.invokeTool` — so whatever is proven here is what the model
 * path will be subject to.
 */
export async function invokeTool(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = InvokeToolSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      return;
    }

    // The single point where an actor comes into existence, from req.auth.
    const actor = actorFromRequest(req);

    const outcome = await chatbotService.invokeTool(parsed.data.tool, parsed.data.args, actor, {
      requestId: req.requestId,
      ipAddress: req.ip,
    });

    if (outcome.status === 'DENIED') {
      // A denial is an authorization outcome, not a validation failure —
      // 403 regardless of which gate stopped it, so the response never
      // reveals which specific check the caller failed.
      next(new ForbiddenError(outcome.reason));
      return;
    }

    if (outcome.status === 'FAILED') {
      // A structured failure, not a 500: the owning service refused or a
      // dependency was unavailable, and the caller needs the CODE to decide
      // whether retrying is sensible. 409 for a business-rule conflict, 503
      // for something transient, 422 for bad arguments -- so a client can act
      // on the status line without parsing prose.
      // TRANSLATED AT THE BOUNDARY. The tool error codes are an INTERNAL
      // vocabulary; the HTTP API has its own (ERROR_CODES) and clients switch
      // on it. Emitting 'FORBIDDEN' where every other endpoint emits
      // 'INSUFFICIENT_PERMISSION' would be a breaking change to this
      // endpoint's contract, introduced by an internal refactor -- exactly the
      // kind of leak a boundary exists to prevent.
      //
      // `retryable` and `next_action` are ADDITIVE: a client reading only
      // `error.code` and `error.message` sees the shape it always saw.
      const MAPPING: Record<string, { status: number; code: string }> = {
        TEMPORARY: { status: 503, code: ERROR_CODES.SERVICE_UNAVAILABLE },
        INVALID_INPUT: { status: 422, code: ERROR_CODES.VALIDATION_ERROR },
        NOT_FOUND: { status: 404, code: ERROR_CODES.RESOURCE_NOT_FOUND },
        AMBIGUOUS: { status: 409, code: ERROR_CODES.VALIDATION_ERROR },
        FORBIDDEN: { status: 403, code: ERROR_CODES.INSUFFICIENT_PERMISSION },
        CONFLICT: { status: 409, code: ERROR_CODES.OPERATION_NOT_ALLOWED },
        INTERNAL: { status: 500, code: ERROR_CODES.INTERNAL_ERROR },
      };
      const mapped = MAPPING[outcome.error.code] ?? {
        status: 500,
        code: ERROR_CODES.INTERNAL_ERROR,
      };

      res.status(mapped.status).json({
        status: 'error',
        error: {
          code: mapped.code,
          message: outcome.error.message,
          retryable: outcome.error.retryable,
          next_action: outcome.error.nextAction,
        },
        meta: { timestamp: new Date().toISOString(), request_id: req.requestId },
      });
      return;
    }

    sendSuccess(res, outcome.result, { requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}

export async function listTools(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = actorFromRequest(req);
    sendSuccess(res, chatbotService.listAvailableTools(actor), { requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}

/** POST /chatbot/conversations — IF-CHATBOT-StartConversation. */
export async function startConversation(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = StartConversationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      return;
    }
    const actor = actorFromRequest(req);
    const conversation = await chatbotService.startConversation(actor);
    sendSuccess(
      res,
      { id: conversation.id, status: conversation.status, purpose: conversation.purpose },
      { statusCode: 201, requestId: req.requestId }
    );
  } catch (error) {
    next(error);
  }
}

/** POST /chatbot/conversations/:id/messages — IF-CHATBOT-ExchangeMessage. */
export async function exchangeMessage(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = ExchangeMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError('Invalid request body', zodDetails(parsed.error)));
      return;
    }
    const actor = actorFromRequest(req);
    const result = await chatbotService.exchangeMessage(
      req.params.id,
      actor,
      { text: parsed.data.text, commandId: parsed.data.command_id, confirmToken: parsed.data.confirm_token },
      { requestId: req.requestId }
    );
    sendSuccess(res, result, { requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}

/** GET /chatbot/conversations/:id — outcome only, never the transcript. */
export async function getConversation(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = actorFromRequest(req);
    const outcome = await chatbotService.getConversationOutcome(req.params.id, actor);
    sendSuccess(res, outcome, { requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}

/** GET /chatbot/conversations — the caller's own recent conversations (History). */
export async function listConversations(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = actorFromRequest(req);
    sendSuccess(res, await chatbotService.listMyConversations(actor), { requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /chatbot/conversations/:id/messages — one of the caller's own
 * conversations, read back. The person's own data on their own screen; see
 * memory/transcript.ts for why this does not touch ADR-074 §5.1.
 */
export async function getConversationMessages(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = actorFromRequest(req);
    sendSuccess(res, await chatbotService.getMyTranscript(req.params.id, actor), {
      requestId: req.requestId,
    });
  } catch (error) {
    next(error);
  }
}

/** GET /chatbot/commands — the L0 manifest the client renders as chips. */
export async function listCommands(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // The actor decides WHICH chips: a chip whose tool this person cannot
    // call is a button that can only answer "You do not have access to that".
    const actor = actorFromRequest(req);
    sendSuccess(res, commandManifest(actor), { requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}
