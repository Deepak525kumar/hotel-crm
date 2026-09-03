import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
  type Tool,
} from '@aws-sdk/client-bedrock-runtime';
import type { DocumentType } from '@smithy/types';
import { getEnv } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import {
  ProviderUnavailableError,
  type LlmMessage,
  type LlmProvider,
  type LlmResponse,
  type LlmToolSpec,
} from './llm-provider.js';

/**
 * AWS Bedrock, the one real `LlmProvider`.
 *
 * WHY BEDROCK, not the Anthropic API directly (owner decision, 2026-09-04):
 *
 *  1. **Data residency.** The platform already stores German workforce data
 *     -- SOCIAL_SECURITY_NUMBER, TAX_NUMBER -- in `eu-central-1`. Bedrock's
 *     `eu.`-prefixed inference profiles keep inference inside EU regions, so
 *     a conversation about a worker's record does not leave the jurisdiction
 *     its subject's data already lives in. This was the live GDPR dimension
 *     CHATBOT_HANDOFF.md flagged as blocking provider selection.
 *  2. **No API key exists to leak.** Bedrock authenticates through the
 *     instance's IAM role via the default credential chain. The alternative
 *     needed a long-lived secret placed by hand in the production `.env` --
 *     a file that is untracked, hand-maintained, and outside code review.
 *     Nothing here reads a key, and nothing should be added that does.
 *  3. One vendor, one bill, one existing data-processing agreement.
 *
 * WHY THE CONVERSE API rather than `InvokeModel`: Converse is the API that
 * accepts inference-profile ids, and it carries tool use as first-class
 * typed content blocks instead of a model-specific JSON envelope this module
 * would otherwise have to hand-assemble and re-parse. Verified against the
 * live service, not assumed -- `InvokeModel` is rejected outright for these
 * profiles.
 *
 * TWO MODELS, chosen per turn by the caller (owner decision, 2026-09-04):
 * a fast model for chat, routing and reads, and a stronger one for planning
 * and writes. Turning a week of dictated prose into forty assignments is a
 * different task from answering "when do I work", and paying planning rates
 * for the second question is the single easiest way to make this expensive.
 */

export type ModelTier = 'fast' | 'planning';

/** Shapes the SDK's union content blocks into the seam's flat response. */
function readResponse(blocks: ContentBlock[] | undefined): {
  text: string;
  toolUse: { name: string; input: unknown } | null;
} {
  let text = '';
  let toolUse: { name: string; input: unknown } | null = null;

  for (const block of blocks ?? []) {
    if ('text' in block && typeof block.text === 'string') {
      text += block.text;
      continue;
    }
    // Only the FIRST tool use is taken. The orchestrator executes one tool
    // per turn and records it against a turn index; accepting a second here
    // would silently drop it after the model believed it had been run.
    if ('toolUse' in block && block.toolUse && !toolUse) {
      toolUse = { name: block.toolUse.name ?? '', input: block.toolUse.input ?? {} };
    }
  }

  return { text: text.trim(), toolUse };
}

export class BedrockProvider implements LlmProvider {
  readonly modelId: string;
  private readonly client: BedrockRuntimeClient;
  private readonly planningModelId: string;
  private readonly timeoutMs: number;

  constructor(params: {
    region: string;
    fastModelId: string;
    planningModelId: string;
    timeoutMs: number;
  }) {
    this.modelId = params.fastModelId;
    this.planningModelId = params.planningModelId;
    this.timeoutMs = params.timeoutMs;
    // No credentials argument on purpose: the default chain resolves the
    // EC2 instance role in production and the developer's profile locally.
    // Passing keys explicitly would invite exactly the stored secret that
    // choosing Bedrock avoids.
    this.client = new BedrockRuntimeClient({ region: params.region });
  }

  async completeWithTools(params: {
    system: string;
    messages: LlmMessage[];
    tools: LlmToolSpec[];
    tier?: ModelTier;
  }): Promise<LlmResponse> {
    const modelId = params.tier === 'planning' ? this.planningModelId : this.modelId;

    const messages: Message[] = params.messages.map((m) => ({
      role: m.role,
      content: [{ text: m.content }],
    }));

    // An empty messages array is rejected by the service. It is also a real
    // shape the opening turn can produce -- the prototype hit exactly this
    // and would have failed on its first live call -- so it is refused here
    // with a message that says which layer is wrong, rather than surfacing a
    // generic ValidationException from the SDK.
    if (messages.length === 0) {
      throw new ProviderUnavailableError('cannot call the model with no messages');
    }

    const toolConfig =
      params.tools.length > 0
        ? {
            tools: params.tools.map(
              (t): Tool => ({
                toolSpec: {
                  name: t.name,
                  description: t.description,
                  // The SDK types this as its own recursive DocumentType.
                  // A tool's input_schema is a JSON Schema object, which is
                  // a valid document -- but the two types are not
                  // structurally assignable, so the cast is the narrowest
                  // way to express that rather than loosening the seam's
                  // own Record<string, unknown>.
                  inputSchema: { json: t.input_schema as unknown as DocumentType },
                },
              })
            ),
          }
        : undefined;

    // AbortController, not just the SDK's socket timeouts: CHATBOT_TURN_TIMEOUT_MS
    // is a promise the HTTP layer makes to the caller, and it has to hold even
    // when the connection is open but the service is slow.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);

    try {
      const response = await this.client.send(
        new ConverseCommand({
          modelId,
          system: [{ text: params.system }],
          messages,
          ...(toolConfig ? { toolConfig } : {}),
        }),
        { abortSignal: abort.signal }
      );

      const { text, toolUse } = readResponse(response.output?.message?.content);

      return {
        text,
        toolUse,
        // Reported by the service rather than estimated. The budget guard
        // enforces a hard spend cap against these numbers, so an estimate
        // would make the cap approximate in exactly the direction that costs
        // money.
        usage: {
          promptTokens: response.usage?.inputTokens ?? 0,
          completionTokens: response.usage?.outputTokens ?? 0,
        },
      };
    } catch (error) {
      // Every provider failure becomes ProviderUnavailableError, which the
      // orchestrator maps to a `fallback-triggered` outcome (RULE-CHAT-03).
      // A throttle, a timeout and an unauthorized model are all "the
      // assistant cannot answer right now" to a worker; none is a 500.
      const name = error instanceof Error ? error.name : 'unknown';
      logger.warn('chatbot_provider_call_failed', {
        model_id: modelId,
        error_name: name,
        message: error instanceof Error ? error.message : String(error),
      });
      throw new ProviderUnavailableError(`bedrock call failed (${name})`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Builds the provider from configuration, or returns null when it is not
 * configured.
 *
 * Null rather than throwing: "no provider" is a supported runtime state --
 * L0 answers the highest-frequency questions with no model at all, and the
 * orchestrator already degrades to the confirmed fallback. A boot failure
 * here would take the whole API down over an optional subsystem.
 */
export function buildBedrockProvider(): BedrockProvider | null {
  const env = getEnv();
  if (env.CHATBOT_PROVIDER !== 'bedrock') return null;

  return new BedrockProvider({
    region: env.CHATBOT_BEDROCK_REGION,
    fastModelId: env.CHATBOT_MODEL_FAST,
    planningModelId: env.CHATBOT_MODEL_PLANNING,
    timeoutMs: env.CHATBOT_TURN_TIMEOUT_MS,
  });
}
