import { describe, it, expect } from '@jest/globals';
import { ExchangeMessageSchema } from '../modules/chatbot/types.js';

describe('ExchangeMessageSchema backward compatibility', () => {
  it('still accepts every request shape that worked before confirm_token existed', () => {
    expect(ExchangeMessageSchema.safeParse({ text: 'my shifts' }).success).toBe(true);
    expect(ExchangeMessageSchema.safeParse({ command_id: 'my_shifts' }).success).toBe(true);
  });
  it('accepts a confirmation-only turn', () => {
    expect(ExchangeMessageSchema.safeParse({ confirm_token: 'abc' }).success).toBe(true);
  });
  it('still rejects the combinations that were invalid before', () => {
    expect(ExchangeMessageSchema.safeParse({ text: 'x', command_id: 'y' }).success).toBe(false);
    expect(ExchangeMessageSchema.safeParse({}).success).toBe(false);
  });
  it('rejects mixing a confirmation with anything else', () => {
    expect(ExchangeMessageSchema.safeParse({ text: 'x', confirm_token: 'z' }).success).toBe(false);
    expect(ExchangeMessageSchema.safeParse({ command_id: 'y', confirm_token: 'z' }).success).toBe(false);
    expect(ExchangeMessageSchema.safeParse({ text: 'x', command_id: 'y', confirm_token: 'z' }).success).toBe(false);
  });
  it('bounds the token so an oversized string cannot be pushed through', () => {
    expect(ExchangeMessageSchema.safeParse({ confirm_token: 'a'.repeat(2049) }).success).toBe(false);
    expect(ExchangeMessageSchema.safeParse({ confirm_token: '' }).success).toBe(false);
  });
});

describe('CHATBOT_CONFIRM_TOKEN_SECRET boot guard', () => {
  const ORIGINAL = process.env;
  const BASE = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
    JWT_SECRET: 'test-secret-key-minimum-32-characters-long',
    JWT_REFRESH_SECRET: 'test-refresh-secret-minimum-32-chars-xx',
  };
  async function load(over: Record<string, string> = {}) {
    jest.resetModules();
    process.env = { ...ORIGINAL, ...BASE, ...over } as NodeJS.ProcessEnv;
    return (await import('../config/env.js')).loadEnv();
  }
  afterEach(() => { process.env = ORIGINAL; });

  it('boots fine with the flag OFF and no secret — read-only deployments are unaffected', async () => {
    await expect(load({ FEATURE_CHATBOT: 'false' })).resolves.toBeDefined();
  });

  it('REFUSES to boot with the flag ON and no secret', async () => {
    // Previously optional. The confirmation flow now exists, so this would
    // otherwise fail at runtime, in front of a user mid-task.
    await expect(load({ FEATURE_CHATBOT: 'true' })).rejects.toThrow(/CHATBOT_CONFIRM_TOKEN_SECRET is required/);
  });

  it('refuses a too-short secret with the flag on', async () => {
    await expect(load({ FEATURE_CHATBOT: 'true', CHATBOT_CONFIRM_TOKEN_SECRET: 'short' }))
      .rejects.toThrow(/at least 32 characters/);
  });

  it('boots with the flag on and a proper secret', async () => {
    await expect(load({ FEATURE_CHATBOT: 'true', CHATBOT_CONFIRM_TOKEN_SECRET: 'z'.repeat(40) }))
      .resolves.toBeDefined();
  });
});
