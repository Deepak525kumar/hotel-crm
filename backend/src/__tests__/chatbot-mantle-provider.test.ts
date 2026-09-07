import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockSign = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
jest.mock('@smithy/signature-v4', () => ({
  SignatureV4: class {
    sign = mockSign;
  },
}));
jest.mock('@aws-sdk/credential-provider-node', () => ({ defaultProvider: () => async () => ({}) }));
jest.mock('@aws-crypto/sha256-js', () => ({ Sha256: class {} }));

let envValue: Record<string, unknown> = {};
jest.mock('../config/env.js', () => ({
  getEnv: () => envValue,
  loadEnv: jest.fn() as jest.MockedFunction<(...a: any[]) => any>,
}));

import {
  MantleProvider,
  readResponse,
  buildMantleProvider,
} from '../modules/chatbot/provider/mantle-provider.js';
import { ProviderUnavailableError } from '../modules/chatbot/provider/llm-provider.js';

const provider = () =>
  new MantleProvider({
    region: 'eu-central-1',
    fastModelId: 'qwen.fast',
    planningModelId: 'qwen.planning',
    timeoutMs: 20000,
  });

const okBody = (over: Record<string, unknown> = {}) => ({
  choices: [{ finish_reason: 'stop', message: { content: 'hello', tool_calls: [] } }],
  usage: { prompt_tokens: 10, completion_tokens: 3 },
  ...over,
});

/** Typed accessor for the request body of call `n`. */
function sentBody(n = 0): Record<string, any> {
  const calls = (global.fetch as unknown as jest.Mock).mock.calls as unknown as Array<[string, { body: string }]>;
  return JSON.parse(calls[n][1].body);
}

/** Typed accessor for the URL of call `n`. */
function sentUrl(n = 0): string {
  const calls = (global.fetch as unknown as jest.Mock).mock.calls as unknown as Array<[string, unknown]>;
  return calls[n][0];
}

function mockFetch(status: number, body: unknown) {
  global.fetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

describe('MantleProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    envValue = {};
    mockSign.mockResolvedValue({ headers: { authorization: 'AWS4-HMAC-SHA256 ...' } });
  });

  it('targets the EU host, on the .api.aws suffix', async () => {
    // Verified against the live service: `.amazonaws.com` is NXDOMAIN, and
    // eu-central-1 exists (the console's N. Virginia framing is misleading).
    mockFetch(200, okBody());
    await provider().completeWithTools({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] });
    expect(sentUrl()).toBe('https://bedrock-mantle.eu-central-1.api.aws/v1/chat/completions');
  });

  it('uses the generic chat route, not the anthropic or openai ones', async () => {
    // `/anthropic/v1/messages` and `/openai/v1/chat/completions` both exist
    // but reject these models — both returned 400 when probed.
    mockFetch(200, okBody());
    await provider().completeWithTools({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] });
    expect(sentUrl()).toContain('/v1/chat/completions');
    expect(sentUrl()).not.toContain('/anthropic/');
    expect(sentUrl()).not.toContain('/openai/');
  });

  it('sends the system prompt as a message, since this shape has no system field', async () => {
    mockFetch(200, okBody());
    await provider().completeWithTools({
      system: 'you are helpful',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
    });
    const body = sentBody();
    expect(body.messages[0]).toEqual({ role: 'system', content: 'you are helpful' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('keeps dotted tool names intact', async () => {
    // Verified live: the endpoint accepts and echoes them, so no mangling.
    mockFetch(200, okBody());
    await provider().completeWithTools({
      system: 's',
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'assignments.list_mine', description: 'd', input_schema: { type: 'object' } }],
    });
    const body = sentBody();
    expect(body.tools[0].function.name).toBe('assignments.list_mine');
    expect(body.tools[0].type).toBe('function');
  });

  it('omits tools entirely when there are none', async () => {
    mockFetch(200, okBody());
    await provider().completeWithTools({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] });
    const body = sentBody();
    expect(body.tools).toBeUndefined();
  });

  it('selects the planning model only when asked, defaulting to fast', async () => {
    mockFetch(200, okBody());
    const p = provider();
    await p.completeWithTools({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] });
    expect(sentBody(0).model).toBe('qwen.fast');

    await p.completeWithTools({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [], tier: 'planning' });
    expect(sentBody(1).model).toBe('qwen.planning');
  });

  it('refuses an empty messages array locally', async () => {
    mockFetch(200, okBody());
    await expect(
      provider().completeWithTools({ system: 's', messages: [], tools: [] }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('converts a non-2xx into ProviderUnavailableError without leaking the body', async () => {
    mockFetch(403, { message: 'arn:aws:bedrock:eu-central-1:851226124478:secret' });
    await expect(
      provider().completeWithTools({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] }),
    ).rejects.toThrow(/mantle call failed \(HTTP 403\)/);
  });
});

describe('readResponse', () => {
  it('parses the tool call, whose arguments arrive as a JSON STRING', () => {
    // Unlike Converse, which hands back a parsed object.
    const r = readResponse({
      choices: [{ message: { content: null, tool_calls: [{ function: { name: 'a.b', arguments: '{"limit":7}' } }] } }],
      usage: { prompt_tokens: 181, completion_tokens: 22 },
    });
    expect(r.toolUse).toEqual({ name: 'a.b', input: { limit: 7 } });
    expect(r.usage).toEqual({ promptTokens: 181, completionTokens: 22 });
  });

  it('takes only the FIRST tool call', () => {
    const r = readResponse({
      choices: [{ message: { tool_calls: [
        { function: { name: 'first', arguments: '{}' } },
        { function: { name: 'second', arguments: '{}' } },
      ] } }],
    });
    expect(r.toolUse?.name).toBe('first');
  });

  it('survives unparseable tool arguments instead of failing the turn', () => {
    // A model can emit malformed JSON. The executor validates against the
    // tool's own strict schema anyway, so an empty object reaches it and is
    // rejected there — with the tool's error, not a parse crash.
    const r = readResponse({
      choices: [{ message: { tool_calls: [{ function: { name: 'a.b', arguments: '{not json' } }] } }],
    });
    expect(r.toolUse).toEqual({ name: 'a.b', input: {} });
  });

  it('returns null toolUse for a plain text answer', () => {
    const r = readResponse({ choices: [{ message: { content: '  hello  ' } }] });
    expect(r.toolUse).toBeNull();
    expect(r.text).toBe('hello');
  });

  it('tolerates an empty or malformed payload', () => {
    expect(readResponse({}).text).toBe('');
    expect(readResponse({}).usage).toEqual({ promptTokens: 0, completionTokens: 0 });
    expect(readResponse({ choices: [] }).toolUse).toBeNull();
  });
});

describe('buildMantleProvider', () => {
  it('returns null unless mantle is the selected provider', () => {
    envValue = { CHATBOT_PROVIDER: 'bedrock' };
    expect(buildMantleProvider()).toBeNull();
    envValue = { CHATBOT_PROVIDER: 'none' };
    expect(buildMantleProvider()).toBeNull();
  });

  it('builds when selected', () => {
    envValue = {
      CHATBOT_PROVIDER: 'mantle',
      CHATBOT_BEDROCK_REGION: 'eu-central-1',
      CHATBOT_MANTLE_MODEL_FAST: 'qwen.fast',
      CHATBOT_MANTLE_MODEL_PLANNING: 'qwen.planning',
      CHATBOT_TURN_TIMEOUT_MS: 20000,
    };
    expect(buildMantleProvider()?.modelId).toBe('qwen.fast');
  });
});
