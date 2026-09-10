import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

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

/**
 * `global.fetch` is a PROCESS global, and jest resets the module registry
 * between test files but never globals. The suite runs `--runInBand`, in one
 * process, so a mock installed here and left in place is still installed for
 * every file that runs afterwards -- any of which that calls fetch without
 * mocking it first gets a mantle-shaped response to a question it never
 * asked. Two suites have shown intermittent failures in full runs while
 * passing alone; this is one real mechanism for that, whether or not it is
 * the only one.
 *
 * The two other suites that touch global.fetch (push-provider,
 * email-provider) already save and restore it. This one did not.
 */
const originalFetch = global.fetch;
// afterEACH, not afterAll: the hygiene guard in setupFilesAfterEnv registers
// its own root-level afterAll first, so it runs BEFORE any afterAll declared
// here and would report this file as leaking even after it had cleaned up.
// Restoring per test is also simply more honest -- nothing here needs the mock
// to survive a test.
afterEach(() => {
  global.fetch = originalFetch;
});

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

/**
 * THE FALLBACK MODEL.
 *
 * A second model a turn can be served by when the primary fails in a way a
 * different model might not. Most of these tests are about when it must NOT
 * fire: a fallback that retries everything turns one fast, honest failure
 * into two slow ones, and hides misconfiguration (a 403 from a missing IAM
 * grant would look like a flaky model rather than a broken policy).
 */
describe('MantleProvider fallback model', () => {
  const withFallback = () =>
    new MantleProvider({
      region: 'eu-central-1',
      fastModelId: 'qwen.fast',
      planningModelId: 'qwen.planning',
      fallbackModelId: 'openai.fallback',
      timeoutMs: 20000,
    });

  const turn = { system: 's', messages: [{ role: 'user' as const, content: 'x' }], tools: [] };

  /** First call fails with `status`, second succeeds. */
  function mockFetchThen(status: number, body: unknown) {
    let n = 0;
    global.fetch = jest.fn(async () => {
      n += 1;
      if (n === 1) {
        return {
          ok: false,
          status,
          json: async () => ({}),
          text: async () => 'upstream detail',
        };
      }
      return { ok: true, status: 200, json: async () => body, text: async () => '' };
    }) as unknown as typeof fetch;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    envValue = {};
    mockSign.mockResolvedValue({ headers: { authorization: 'AWS4-HMAC-SHA256 ...' } });
  });

  it.each([
    ['throttling', 429],
    ['model not served', 404],
    ['service fault', 503],
  ])('retries on the fallback model when the primary returns %s', async (_label, status) => {
    mockFetchThen(status, okBody());

    const result = await withFallback().completeWithTools(turn);

    expect(result.text).toBe('hello');
    expect(sentBody(0).model).toBe('qwen.fast');
    expect(sentBody(1).model).toBe('openai.fallback');
  });

  it.each([
    ['a malformed request', 400],
    ['an authorization failure', 403],
    ['an unauthenticated call', 401],
  ])('does NOT retry on %s -- the second model would fail identically', async (_label, status) => {
    mockFetchThen(status, okBody());

    await expect(withFallback().completeWithTools(turn)).rejects.toBeInstanceOf(
      ProviderUnavailableError
    );
    // One call only. Falling back here would hide a broken IAM policy behind
    // a slower error and double the cost of every misconfigured request.
    expect((global.fetch as unknown as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('never calls twice when no fallback is configured', async () => {
    mockFetchThen(503, okBody());

    await expect(provider().completeWithTools(turn)).rejects.toBeInstanceOf(
      ProviderUnavailableError
    );
    expect((global.fetch as unknown as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('does not fall back to the model that just failed', async () => {
    mockFetchThen(503, okBody());
    const same = new MantleProvider({
      region: 'eu-central-1',
      fastModelId: 'qwen.fast',
      planningModelId: 'qwen.planning',
      fallbackModelId: 'qwen.fast', // same id
      timeoutMs: 20000,
    });

    await expect(same.completeWithTools(turn)).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect((global.fetch as unknown as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('treats an empty fallback id as "no fallback", so it can be switched off by config', async () => {
    mockFetchThen(503, okBody());
    const off = new MantleProvider({
      region: 'eu-central-1',
      fastModelId: 'qwen.fast',
      planningModelId: 'qwen.planning',
      fallbackModelId: '   ',
      timeoutMs: 20000,
    });

    await expect(off.completeWithTools(turn)).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect((global.fetch as unknown as jest.Mock).mock.calls).toHaveLength(1);
  });

  /**
   * THE BUDGET RULE. The turn has one timeout, shared by both attempts. A
   * fallback started after the primary spent it would double the worst case
   * and answer into a request the client has already abandoned.
   */
  it('does not start a fallback when the turn budget is already spent', async () => {
    mockFetchThen(503, okBody());
    const noBudget = new MantleProvider({
      region: 'eu-central-1',
      fastModelId: 'qwen.fast',
      planningModelId: 'qwen.planning',
      fallbackModelId: 'openai.fallback',
      timeoutMs: 1, // deadline passes during the first attempt
    });

    await expect(noBudget.completeWithTools(turn)).rejects.toBeInstanceOf(
      ProviderUnavailableError
    );
    expect((global.fetch as unknown as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('passes the same tools and system prompt to the fallback', async () => {
    mockFetchThen(503, okBody());
    await withFallback().completeWithTools({
      system: 'the system prompt',
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'a.b', description: 'd', input_schema: { type: 'object' } }],
    });

    // A fallback that dropped the manifest would answer without any tool and
    // look like a model that simply chose not to act.
    expect(sentBody(1).tools[0].function.name).toBe('a.b');
    expect(sentBody(1).messages[0]).toEqual({ role: 'system', content: 'the system prompt' });
  });

  it('uses the fallback for the planning tier too, not just the fast one', async () => {
    mockFetchThen(503, okBody());
    await withFallback().completeWithTools({ ...turn, tier: 'planning' });

    expect(sentBody(0).model).toBe('qwen.planning');
    expect(sentBody(1).model).toBe('openai.fallback');
  });
});
