import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockSend = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class {
    send = mockSend;
  },
  ConverseCommand: class {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  },
}));

jest.mock('../config/env.js', () => ({
  getEnv: () => envValue,
  loadEnv: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
}));

let envValue: Record<string, unknown> = {};

import { BedrockProvider, buildBedrockProvider } from '../modules/chatbot/provider/bedrock-provider.js';
import { ProviderUnavailableError } from '../modules/chatbot/provider/llm-provider.js';

const FAST = 'eu.anthropic.claude-haiku-4-5-20251001-v1:0';
const PLANNING = 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0';

const provider = () =>
  new BedrockProvider({ region: 'eu-central-1', fastModelId: FAST, planningModelId: PLANNING, timeoutMs: 20000 });

describe('BedrockProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    envValue = {};
  });

  it('returns the assistant text and the service-reported usage', async () => {
    mockSend.mockResolvedValue({
      output: { message: { content: [{ text: '  You work Tuesday.  ' }] } },
      usage: { inputTokens: 120, outputTokens: 8 },
    });

    const result = await provider().completeWithTools({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [] });

    expect(result.text).toBe('You work Tuesday.');
    expect(result.toolUse).toBeNull();
    // Usage must come from the service: the budget guard enforces a hard
    // spend cap against these, so an estimate would make the cap approximate.
    expect(result.usage).toEqual({ promptTokens: 120, completionTokens: 8 });
  });

  it('takes only the FIRST tool use, never a second', async () => {
    // The orchestrator runs one tool per turn against a turn index. A second
    // accepted here would be silently dropped after the model believed it ran.
    mockSend.mockResolvedValue({
      output: {
        message: {
          content: [
            { text: 'Checking.' },
            { toolUse: { name: 'assignments.list_mine', input: { a: 1 } } },
            { toolUse: { name: 'something.else', input: { b: 2 } } },
          ],
        },
      },
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const result = await provider().completeWithTools({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] });
    expect(result.toolUse).toEqual({ name: 'assignments.list_mine', input: { a: 1 } });
    expect(result.text).toBe('Checking.');
  });

  it('uses the FAST model by default and the planning model only when asked', async () => {
    mockSend.mockResolvedValue({ output: { message: { content: [{ text: 'ok' }] } }, usage: {} });
    const p = provider();

    await p.completeWithTools({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] });
    expect(mockSend.mock.calls[0][0].input.modelId).toBe(FAST);

    await p.completeWithTools({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [], tier: 'planning' });
    expect(mockSend.mock.calls[1][0].input.modelId).toBe(PLANNING);

    // Forgetting to choose must land on the cheap model, not the expensive one.
    await p.completeWithTools({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [], tier: undefined });
    expect(mockSend.mock.calls[2][0].input.modelId).toBe(FAST);
  });

  it('sends an EU-resident inference profile id', async () => {
    mockSend.mockResolvedValue({ output: { message: { content: [{ text: 'ok' }] } }, usage: {} });
    await provider().completeWithTools({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] });
    // The `eu.` prefix IS the residency guarantee. A bare `anthropic.*` id
    // routes without it, which is the whole reason Bedrock was chosen.
    expect(mockSend.mock.calls[0][0].input.modelId).toMatch(/^eu\./);
  });

  it('omits toolConfig entirely when there are no tools', async () => {
    mockSend.mockResolvedValue({ output: { message: { content: [{ text: 'ok' }] } }, usage: {} });
    await provider().completeWithTools({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] });
    expect(mockSend.mock.calls[0][0].input.toolConfig).toBeUndefined();
  });

  it('refuses an empty messages array instead of letting the service reject it', async () => {
    // The throwaway prototype would have failed on its very first live call
    // with exactly this shape on the opening turn.
    await expect(
      provider().completeWithTools({ system: 's', messages: [], tools: [] })
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('converts ANY provider failure into ProviderUnavailableError, never a raw throw', async () => {
    // A throttle, a timeout and an unauthorized model are all "cannot answer
    // right now" to a worker (RULE-CHAT-03), never a 500.
    for (const err of [
      Object.assign(new Error('rate exceeded'), { name: 'ThrottlingException' }),
      Object.assign(new Error('not authorized'), { name: 'AccessDeniedException' }),
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    ]) {
      mockSend.mockRejectedValueOnce(err);
      await expect(
        provider().completeWithTools({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] })
      ).rejects.toBeInstanceOf(ProviderUnavailableError);
    }
  });

  it('does not leak the provider error message to the caller verbatim', async () => {
    mockSend.mockRejectedValue(Object.assign(new Error('arn:aws:bedrock:eu-central-1:851226124478:secret'), { name: 'AccessDeniedException' }));
    await expect(
      provider().completeWithTools({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] })
    ).rejects.toThrow(/bedrock call failed \(AccessDeniedException\)/);
  });
});

describe('buildBedrockProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when no provider is configured — a supported runtime state', () => {
    // L0 answers the highest-frequency questions with no model at all.
    envValue = { CHATBOT_PROVIDER: 'none' };
    expect(buildBedrockProvider()).toBeNull();
  });

  it('builds the provider when bedrock is selected', () => {
    envValue = {
      CHATBOT_PROVIDER: 'bedrock',
      CHATBOT_BEDROCK_REGION: 'eu-central-1',
      CHATBOT_MODEL_FAST: FAST,
      CHATBOT_MODEL_PLANNING: PLANNING,
      CHATBOT_TURN_TIMEOUT_MS: 20000,
    };
    const p = buildBedrockProvider();
    expect(p).not.toBeNull();
    expect(p!.modelId).toBe(FAST);
  });
});
