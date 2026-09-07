import { Request, Response, NextFunction } from 'express';
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
      const status =
        outcome.error.code === 'TEMPORARY' ? 503
        : outcome.error.code === 'INVALID_INPUT' ? 422
        : outcome.error.code === 'NOT_FOUND' ? 404
        : outcome.error.code === 'FORBIDDEN' ? 403
        : outcome.error.code === 'CONFLICT' ? 409
        : 500;
      res.status(status).json({
        status: 'error',
        error: {
          code: outcome.error.code,
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

/** GET /chatbot/commands — the L0 manifest the client renders as chips. */
export async function listCommands(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    actorFromRequest(req); // authenticated callers only
    sendSuccess(res, commandManifest(), { requestId: req.requestId });
  } catch (error) {
    next(error);
  }
}
