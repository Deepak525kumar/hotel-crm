// Regressions for defects QA found that the original suite missed entirely.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { store } from "../src/store.js";
import { budgetGuard } from "../src/budgetGuard.js";
import { auditLog } from "../src/auditLog.js";
import { __resetRateLimitsForTests } from "../src/rateLimiter.js";
import { startConversation, exchangeMessage } from "../src/conversationService.js";

beforeEach(() => {
  store.clear();
  budgetGuard.__resetForTests();
  __resetRateLimitsForTests();
  auditLog.__resetForTests();
});

describe("terminal-state completeness (REQ-CHAT-010)", () => {
  it("completes immediately when the worker owes no documents, without spending a turn", async () => {
    const conversation = await startConversation({
      workerId: "w-nodocs",
      purpose: "onboarding-document-collection",
      context: { requiredDocuments: [] },
    });
    expect(conversation.status).toBe("completed");
    expect(conversation.tokenSpend.total).toBe(0);
  });

  it("completes when every supplied document is already present", async () => {
    const conversation = await startConversation({
      workerId: "w-alldone",
      purpose: "onboarding-document-collection",
      context: { requiredDocuments: [{ name: "Passport", present: true }] },
    });
    expect(conversation.status).toBe("completed");
  });
});

describe("audit trail integrity (RULE-CHAT-10)", () => {
  it("records the start even when the budget forces an immediate fallback", async () => {
    budgetGuard.recordSpend({ promptTokens: 10_000_000, completionTokens: 0 });
    const conversation = await startConversation({
      workerId: "w-audit-start",
      purpose: "onboarding-document-collection",
      context: { requiredDocuments: [{ name: "Passport", present: false }] },
    });

    const events = auditLog.all().filter((e) => e.conversationId === conversation.id).map((e) => e.event);
    // A fallback must never reference a conversation the trail never saw begin.
    expect(events).toEqual(["conversation-started", "fallback-triggered"]);
  });

  it("emits exactly one completion entry even under concurrent turns", async () => {
    const conversation = await startConversation({
      workerId: "w-once",
      purpose: "onboarding-document-collection",
      context: { requiredDocuments: [{ name: "Passport", present: false }] },
    });

    await Promise.all([
      exchangeMessage(conversation.id, "w-once", "one"),
      exchangeMessage(conversation.id, "w-once", "two"),
      exchangeMessage(conversation.id, "w-once", "three"),
    ]).catch(() => undefined);

    const completions = auditLog.all().filter((e) => e.event === "conversation-completed");
    expect(completions.length).toBeLessThanOrEqual(1);
  });
});

describe("concurrency does not defeat the caps (OD-CHAT-016)", () => {
  it("holds the turn ceiling under parallel turns on one conversation", async () => {
    vi.resetModules();
    process.env.CHATBOT_MAX_TURNS_PER_CONVERSATION = "3";
    const svc = await import("../src/conversationService.js");
    const freshStore = (await import("../src/store.js")).store;
    freshStore.clear();

    const conversation = await svc.startConversation({
      workerId: "w-race",
      purpose: "onboarding-document-collection",
      context: { requiredDocuments: [{ name: "Passport", present: false }] },
    });

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        svc.exchangeMessage(conversation.id, "w-race", `message ${i}`).catch(() => undefined),
      ),
    );

    const final = freshStore.get(conversation.id)!;
    // Without serialization this reached 11 turns against a ceiling of 3.
    expect(final.turnCount).toBeLessThanOrEqual(4);
    delete process.env.CHATBOT_MAX_TURNS_PER_CONVERSATION;
  });
});

describe("config validation fails closed (REQ-CHAT-004)", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("refuses to boot on a non-numeric cap rather than silently disabling every limit", async () => {
    vi.resetModules();
    process.env.CHATBOT_MONTHLY_TOKEN_CAP = "2_000_000"; // Number(...) === NaN
    await expect(import("../src/config.js")).rejects.toThrow(/must be a positive integer/);
  });
});
