// Exercises RULE-CHAT-03's per-conversation cap and the defense-in-depth
// turn-count ceiling. Both need a tiny cap to hit deterministically without a
// slow loop, so this file reloads the modules fresh with env overrides
// (vi.resetModules) rather than sharing state with the other test files.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("budget and turn-count fallbacks", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("falls back once a conversation's own token spend exceeds its cap", async () => {
    process.env.CHATBOT_PER_CONVERSATION_TOKEN_CAP = "50";
    process.env.CHATBOT_MONTHLY_TOKEN_CAP = "2000000";
    const { startConversation, exchangeMessage } = await import("../src/conversationService.js");

    let conversation = await startConversation({
      workerId: "worker-budget",
      purpose: "onboarding-document-collection",
      context: { requiredDocuments: [{ name: "Passport", present: false }] },
    });

    // Each mock turn costs well over 50 tokens combined, so the very first
    // exchange should already push cumulative spend past the tiny cap.
    conversation = await exchangeMessage(conversation.id, "worker-budget", "here is a fairly long message");
    // Verified at the data layer, not just the status field.
    expect(conversation.tokenSpend.total).toBeGreaterThan(50);
    expect(conversation.status).toBe("fallback-triggered");
    expect(conversation.fallbackReason).toBe("conversation-limit-exceeded");
  });

  it("falls back once the turn-count ceiling is reached, independent of token spend", async () => {
    process.env.CHATBOT_MAX_TURNS_PER_CONVERSATION = "1";
    const { startConversation, exchangeMessage } = await import("../src/conversationService.js");

    let conversation = await startConversation({
      workerId: "worker-turns",
      purpose: "onboarding-document-collection",
      context: { requiredDocuments: [{ name: "Passport", present: false }, { name: "Anmeldung", present: false }] },
    });
    expect(conversation.turnCount).toBe(1);

    conversation = await exchangeMessage(conversation.id, "worker-turns", "still working on it");
    expect(conversation.status).toBe("fallback-triggered");
    expect(conversation.fallbackReason).toBe("turn-limit-exceeded");
  });
});
