import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, __resetRateLimitsForTests } from "../src/rateLimiter.js";

describe("rate limiter (OD-CHAT-010 mitigation)", () => {
  beforeEach(() => __resetRateLimitsForTests());

  it("allows up to the configured max within the window, then blocks", () => {
    const results = Array.from({ length: 6 }, () => checkRateLimit("conversationStart", "worker-1"));
    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it("tracks separate windows per worker", () => {
    for (let i = 0; i < 5; i += 1) checkRateLimit("conversationStart", "worker-a");
    expect(checkRateLimit("conversationStart", "worker-a")).toBe(false);
    expect(checkRateLimit("conversationStart", "worker-b")).toBe(true);
  });
});
