import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

/**
 * The three chatbot spend caps are only useful in a specific ORDER:
 *
 *   conversation  <  per-user daily  <  platform monthly
 *
 * Break the order and a cap silently stops being reachable. This is not
 * hypothetical on either end:
 *
 *  - The shipped pairing WAS wrong: 60,000/day against 2,000,000/month meant
 *    roughly 33 worker-days drained the entire platform's month, so the
 *    per-user cap could never bind first and was effectively decorative.
 *  - While RAISING these caps, the first attempt set the conversation cap
 *    (120,000) above the daily cap (40,000), which would have made the
 *    per-conversation limit unreachable. The boot guard caught it.
 *
 * These assertions run against the REAL loaded schema, not a copy of the
 * numbers, so they fail if a default drifts.
 */

const REQUIRED = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  JWT_SECRET: 'test-secret-key-minimum-32-characters-long',
  JWT_REFRESH_SECRET: 'test-refresh-secret-minimum-32-chars-xx',
};

const ORIGINAL = process.env;

async function loadFresh(overrides: Record<string, string> = {}) {
  jest.resetModules();
  process.env = { ...ORIGINAL, ...REQUIRED, ...overrides } as NodeJS.ProcessEnv;
  const mod = await import('../config/env.js');
  return mod.loadEnv();
}

describe('chatbot spend cap ordering', () => {
  beforeEach(() => {
    jest.resetModules();
  });
  afterEach(() => {
    process.env = ORIGINAL;
  });

  it('ships defaults in the only order that makes all three reachable', async () => {
    const env = await loadFresh();
    expect(env.CHATBOT_CONVERSATION_TOKEN_CAP).toBeLessThan(env.CHATBOT_USER_DAILY_TOKEN_CAP);
    expect(env.CHATBOT_USER_DAILY_TOKEN_CAP).toBeLessThan(env.CHATBOT_MONTHLY_TOKEN_CAP);
  });

  it('keeps the monthly cap large enough for the ADR-035 workload', async () => {
    // ADR-035 assumes ~5,000 workers / ~300 concurrent at peak. The projected
    // steady-state for 500 workers plus manager planning is ~18M tokens per
    // month; a cap below that is an outage on a schedule, not a safeguard.
    const env = await loadFresh();
    expect(env.CHATBOT_MONTHLY_TOKEN_CAP).toBeGreaterThanOrEqual(18_000_000);
  });

  it('refuses to boot when a conversation could outlast a user’s whole day', async () => {
    await expect(
      loadFresh({ CHATBOT_CONVERSATION_TOKEN_CAP: '500000', CHATBOT_USER_DAILY_TOKEN_CAP: '100000' })
    ).rejects.toThrow(/CHATBOT_CONVERSATION_TOKEN_CAP.*must be below CHATBOT_USER_DAILY_TOKEN_CAP/s);
  });

  it('refuses to boot when one user could drain the whole platform budget in a day', async () => {
    await expect(
      loadFresh({ CHATBOT_USER_DAILY_TOKEN_CAP: '9000000', CHATBOT_MONTHLY_TOKEN_CAP: '9000000' })
    ).rejects.toThrow(/CHATBOT_USER_DAILY_TOKEN_CAP.*must be below CHATBOT_MONTHLY_TOKEN_CAP/s);
  });

  it('accepts a deliberately smaller, still-ordered configuration', async () => {
    // Lowering the ceiling for a pilot must stay possible -- the guard
    // constrains the ORDER, never the magnitude.
    const env = await loadFresh({
      CHATBOT_CONVERSATION_TOKEN_CAP: '10000',
      CHATBOT_USER_DAILY_TOKEN_CAP: '50000',
      CHATBOT_MONTHLY_TOKEN_CAP: '1000000',
    });
    expect(env.CHATBOT_MONTHLY_TOKEN_CAP).toBe(1_000_000);
  });
});
