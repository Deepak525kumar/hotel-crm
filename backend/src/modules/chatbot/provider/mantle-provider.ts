import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { SignatureV4 } from '@smithy/signature-v4';
import { getEnv } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import {
  ProviderUnavailableError,
  type LlmMessage,
  type LlmProvider,
  type LlmResponse,
  type LlmTier,
  type LlmToolSpec,
} from './llm-provider.js';

/**
 * AWS Bedrock **mantle**, the second `LlmProvider`.
 *
 * WHY A SECOND ONE. `bedrock-runtime` is unusable on this account: every
 * model, including Amazon's own first-party Nova, returns "Operation not
 * allowed" pending an account verification that has stood for days. Mantle
 * is a different service with a different gate, and it works today. Four
 * phases of chatbot work were written against a `bedrock-runtime` API shape
 * verified only by inspection; this is what lets them finally be exercised.
 *
 * EVERY ASSUMPTION BELOW WAS PROBED AGAINST THE LIVE SERVICE, because three
 * earlier ones turned out to be wrong:
 *
 *  - The host is `bedrock-mantle.<region>.api.aws` -- note `.api.aws`, NOT
 *    `.amazonaws.com`. Every `.amazonaws.com` guess was NXDOMAIN.
 *  - It EXISTS IN eu-central-1. The console presents it under N. Virginia,
 *    which is what made it look US-only; it is not, so the data-residency
 *    objection against it does not hold.
 *  - Non-Anthropic models are served at `/v1/chat/completions` in the OpenAI
 *    shape. NOT `/anthropic/v1/messages` (that path exists but rejects them),
 *    and NOT `/openai/v1/chat/completions` (reserved for OpenAI-branded
 *    models). Both were tried and returned 400.
 *  - Dotted tool names (`assignments.list_mine`) are accepted and echoed
 *    back verbatim, so no name mangling is needed. Also verified, because
 *    many OpenAI-compatible endpoints restrict function names to
 *    `[A-Za-z0-9_-]` and silently break dotted ones.
 *
 * AUTH IS SigV4 WITH THE INSTANCE ROLE -- no API key exists, which is the
 * same property that made Bedrock preferable to a direct vendor API in the
 * first place. The AWS SDK has no mantle client yet, so the request is signed
 * directly with `@smithy/signature-v4` rather than hand-rolled.
 *
 * NO ANTHROPIC MODELS are entitled on this account (that needs an AWS Sales
 * conversation), so the configured models are open-weight ones. Tool calling
 * was verified working on Qwen3 235B before this file was written: asked
 * "what are my shifts this week?" it selected the tool and inferred
 * `limit: 7` unprompted.
 */

const SIGNING_SERVICE = 'bedrock';
const CHAT_PATH = '/v1/chat/completions';

/**
 * Below this many milliseconds left, a second attempt is not started.
 *
 * The turn has ONE budget (`CHATBOT_TURN_TIMEOUT_MS`), shared by both
 * attempts rather than granted to each. A fallback that began after the
 * primary had already spent the whole budget would double the worst case and
 * answer into an HTTP request the client has given up on -- a slower failure
 * instead of a faster recovery.
 */
const MIN_FALLBACK_BUDGET_MS = 3000;

/**
 * A failure that a DIFFERENT MODEL might not have.
 *
 * The distinction is the whole point of the fallback: retrying a malformed
 * request or an account-level authorization failure on a second model costs
 * another round trip and fails identically. Only capacity, model-specific,
 * and transport failures are worth a second attempt.
 */
class MantleCallError extends ProviderUnavailableError {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    Object.setPrototypeOf(this, MantleCallError.prototype);
  }
}

/**
 * Which HTTP statuses justify trying the fallback model.
 *
 *   429 -- throttling/capacity on this model.
 *   404 -- the model id is not served (withdrawn, or not in this region).
 *   5xx -- the service's own fault, which may be per-model.
 *
 * Deliberately NOT 400 (our request shape is wrong -- the fallback would
 * reject it too) and NOT 401/403 (account authorization, identical for every
 * model; falling back would hide a misconfigured IAM policy behind a slower
 * error).
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 404 || status >= 500;
}

interface OpenAiToolCall {
  function?: { name?: string; arguments?: string };
}

interface OpenAiResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null; tool_calls?: OpenAiToolCall[] };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class MantleProvider implements LlmProvider {
  readonly modelId: string;
  private readonly planningModelId: string;
  private readonly fallbackModelId: string | null;
  private readonly host: string;
  private readonly timeoutMs: number;
  private readonly signer: SignatureV4;

  constructor(params: {
    region: string;
    fastModelId: string;
    planningModelId: string;
    fallbackModelId?: string | null;
    timeoutMs: number;
  }) {
    this.modelId = params.fastModelId;
    this.planningModelId = params.planningModelId;
    // Empty string means "no fallback", so the behaviour can be switched off
    // by configuration without a deploy.
    this.fallbackModelId = params.fallbackModelId?.trim() || null;
    this.timeoutMs = params.timeoutMs;
    this.host = `bedrock-mantle.${params.region}.api.aws`;
    this.signer = new SignatureV4({
      // Default chain: the EC2 instance role in production, the developer's
      // profile locally. Deliberately no explicit credentials argument --
      // passing keys would reintroduce the stored secret this avoids.
      credentials: defaultProvider(),
      region: params.region,
      service: SIGNING_SERVICE,
      sha256: Sha256,
    });
  }

  async completeWithTools(params: {
    system: string;
    messages: LlmMessage[];
    tools: LlmToolSpec[];
    tier?: LlmTier;
  }): Promise<LlmResponse> {
    const primary = params.tier === 'planning' ? this.planningModelId : this.modelId;

    if (params.messages.length === 0) {
      // Same guard as the Bedrock provider, for the same reason: an empty
      // array is a real shape the opening turn can produce, and refusing it
      // here names the layer at fault instead of surfacing a service error.
      throw new ProviderUnavailableError('cannot call the model with no messages');
    }

    // ONE budget for the whole turn, not one per attempt. See
    // MIN_FALLBACK_BUDGET_MS.
    const deadline = Date.now() + this.timeoutMs;

    try {
      return await this.callModel(primary, params, deadline);
    } catch (error) {
      const fallback = this.fallbackModelId;

      if (!fallback || fallback === primary) throw error;
      if (!(error instanceof MantleCallError) || !error.retryable) throw error;

      const remaining = deadline - Date.now();
      if (remaining < MIN_FALLBACK_BUDGET_MS) {
        logger.warn('chatbot_mantle_fallback_skipped_no_budget', {
          primary_model_id: primary,
          fallback_model_id: fallback,
          remaining_ms: remaining,
        });
        throw error;
      }

      logger.warn('chatbot_mantle_falling_back', {
        primary_model_id: primary,
        fallback_model_id: fallback,
        reason: error.message,
        remaining_ms: remaining,
      });

      const response = await this.callModel(fallback, params, deadline);
      // Logged at info because it is a SUCCESS that answered on the weaker
      // model: the turn worked, and the operator should still know the
      // primary is failing.
      logger.info('chatbot_mantle_served_by_fallback', {
        primary_model_id: primary,
        fallback_model_id: fallback,
      });
      return response;
    }
  }

  /**
   * One attempt against one model.
   *
   * Takes the DEADLINE rather than a duration so the second attempt inherits
   * what the first left, instead of starting a fresh clock.
   */
  private async callModel(
    model: string,
    params: { system: string; messages: LlmMessage[]; tools: LlmToolSpec[] },
    deadline: number
  ): Promise<LlmResponse> {
    // The system prompt is a MESSAGE in this shape, not a separate field as
    // it is in Converse. Prepended rather than merged into the first user
    // message so the model still sees the role boundary.
    const body = JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: params.system },
        ...params.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      ...(params.tools.length > 0
        ? {
            tools: params.tools.map((t) => ({
              type: 'function',
              function: {
                name: t.name,
                description: t.description,
                parameters: t.input_schema,
              },
            })),
          }
        : {}),
    });

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), Math.max(0, deadline - Date.now()));

    try {
      const signed = await this.signer.sign({
        method: 'POST',
        protocol: 'https:',
        hostname: this.host,
        path: CHAT_PATH,
        headers: { host: this.host, 'content-type': 'application/json' },
        body,
      });

      const response = await fetch(`https://${this.host}${CHAT_PATH}`, {
        method: 'POST',
        headers: signed.headers as Record<string, string>,
        body,
        signal: abort.signal,
      });

      if (!response.ok) {
        // Body read for the log only. It can carry account arns and model
        // ids, so it never reaches the caller.
        const detail = await response.text().catch(() => '');
        logger.warn('chatbot_mantle_call_failed', {
          model_id: model,
          status: response.status,
          detail: detail.slice(0, 300),
        });
        throw new MantleCallError(
          `mantle call failed (HTTP ${response.status})`,
          isRetryableStatus(response.status)
        );
      }

      return readResponse((await response.json()) as OpenAiResponse);
    } catch (error) {
      if (error instanceof MantleCallError) throw error;
      if (error instanceof ProviderUnavailableError) throw error;
      const name = error instanceof Error ? error.name : 'unknown';
      logger.warn('chatbot_mantle_call_failed', {
        model_id: model,
        error_name: name,
        message: error instanceof Error ? error.message : String(error),
      });
      // Transport-level: a socket reset or an abort. Worth a second model
      // while budget remains -- the abort case is filtered out by the
      // remaining-budget check, since a timeout leaves none.
      throw new MantleCallError(`mantle call failed (${name})`, true);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Shape one OpenAI-style choice into the seam's flat response. */
export function readResponse(payload: OpenAiResponse): LlmResponse {
  const choice = payload.choices?.[0];
  const calls = choice?.message?.tool_calls ?? [];

  // FIRST tool call only, matching the Bedrock provider and the
  // orchestrator, which executes one tool per turn against a turn index.
  // Accepting a second would silently drop it after the model believed it ran.
  const first = calls[0];
  let toolUse: LlmResponse['toolUse'] = null;

  if (first?.function?.name) {
    // `arguments` is a JSON STRING here, unlike Converse's parsed object. A
    // model can emit malformed JSON, and that is not a reason to fail the
    // whole turn -- the executor validates arguments against the tool's own
    // strict schema anyway, so an empty object reaches it and is rejected
    // there, with the tool's own error rather than a parse crash.
    let input: unknown = {};
    try {
      input = first.function.arguments ? JSON.parse(first.function.arguments) : {};
    } catch {
      logger.warn('chatbot_mantle_tool_args_unparseable', { tool: first.function.name });
      input = {};
    }
    toolUse = { name: first.function.name, input };
  }

  return {
    text: (choice?.message?.content ?? '').trim(),
    toolUse,
    usage: {
      promptTokens: payload.usage?.prompt_tokens ?? 0,
      completionTokens: payload.usage?.completion_tokens ?? 0,
    },
  };
}

/** Built from configuration, or null when mantle is not the selected provider. */
export function buildMantleProvider(): MantleProvider | null {
  const env = getEnv();
  if (env.CHATBOT_PROVIDER !== 'mantle') return null;

  return new MantleProvider({
    region: env.CHATBOT_BEDROCK_REGION,
    fastModelId: env.CHATBOT_MANTLE_MODEL_FAST,
    planningModelId: env.CHATBOT_MANTLE_MODEL_PLANNING,
    fallbackModelId: env.CHATBOT_MANTLE_MODEL_FALLBACK,
    timeoutMs: env.CHATBOT_TURN_TIMEOUT_MS,
  });
}
