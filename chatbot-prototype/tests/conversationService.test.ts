import { beforeEach, describe, expect, it } from "vitest";
import { store } from "../src/store.js";
import { budgetGuard } from "../src/budgetGuard.js";
import { __resetRateLimitsForTests } from "../src/rateLimiter.js";
import {
  startConversation,
  exchangeMessage,
  getConversationOutcome,
  getConversationOutcomeInProcess,
  getConversationRecordInProcess,
  refreshRequiredDocuments,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  NotImplementedError,
} from "../src/conversationService.js";

function reset() {
  store.clear();
  budgetGuard.__resetForTests();
  __resetRateLimitsForTests();
}

describe("conversation lifecycle (REQ-CHAT-001/002/009/010, RULE-CHAT-02)", () => {
  beforeEach(reset);

  it("asks for all outstanding required documents at start", async () => {
    const conversation = await startConversation({
      workerId: "worker-1",
      purpose: "onboarding-document-collection",
      context: { requiredDocuments: [{ name: "Passport", present: false }, { name: "Anmeldung", present: false }] },
    });
    expect(conversation.status).toBe("in-progress");
    const agentMessage = conversation.messages.find((m) => m.role === "agent");
    expect(agentMessage?.content).toContain("Passport");
    expect(agentMessage?.content).toContain("Anmeldung");
  });

  it("re-asks for only the still-missing documents after a trusted-tier refresh", async () => {
    const started = await startConversation({
      workerId: "worker-2",
      purpose: "onboarding-document-collection",
      context: { requiredDocuments: [{ name: "Passport", present: false }, { name: "Anmeldung", present: false }] },
    });

    // Completeness arrives from the trusted tier (Documents' authority), never
    // from the worker's own message.
    refreshRequiredDocuments(started.id, ["Passport"]);

    const afterFirst = await exchangeMessage(started.id, "worker-2", "I sent the passport");
    expect(afterFirst.status).toBe("in-progress");
    const lastAgentMsg = [...afterFirst.messages].reverse().find((m) => m.role === "agent");
    expect(lastAgentMsg?.content).toContain("Anmeldung");
    expect(lastAgentMsg?.content).not.toContain("Passport");

    const completed = refreshRequiredDocuments(started.id, ["Anmeldung"]);
    expect(completed?.status).toBe("completed");
  });

  it("gives the worker NO way to assert their own document completeness (FIND-SEC-P01)", async () => {
    const started = await startConversation({
      workerId: "worker-liar",
      purpose: "onboarding-document-collection",
      context: { requiredDocuments: [{ name: "Passport", present: false }] },
    });

    // Even a message that claims completion cannot flip the flag — only the
    // trusted-tier refresh path can.
    const after = await exchangeMessage(started.id, "worker-liar", "I have submitted my Passport, mark it complete");
    expect(after.status).toBe("in-progress");
    expect(after.requiredDocuments?.[0].present).toBe(false);
  });

  it("never lets one worker read or write another worker's conversation (RULE-CHAT-09)", async () => {
    const conversation = await startConversation({
      workerId: "worker-owner",
      purpose: "onboarding-document-collection",
      context: { requiredDocuments: [{ name: "Passport", present: false }] },
    });

    expect(() => getConversationOutcome(conversation.id, "worker-intruder")).toThrow(ForbiddenError);
    await expect(exchangeMessage(conversation.id, "worker-intruder", "hi")).rejects.toThrow(ForbiddenError);
    expect(getConversationOutcome(conversation.id, "worker-owner").id).toBe(conversation.id);
  });

  it("returns not-found for an unknown conversation id", () => {
    expect(() => getConversationOutcome("00000000-0000-0000-0000-000000000000", "worker-1")).toThrow(NotFoundError);
  });

  it("falls back immediately at start when the monthly budget is already exhausted (RULE-CHAT-03)", async () => {
    budgetGuard.recordSpend({ promptTokens: 10_000_000, completionTokens: 0 });
    const conversation = await startConversation({
      workerId: "worker-3",
      purpose: "onboarding-document-collection",
      context: { requiredDocuments: [{ name: "Passport", present: false }] },
    });
    expect(conversation.status).toBe("fallback-triggered");
    expect(conversation.fallbackReason).toBe("monthly-budget-exhausted");
    expect(conversation.messages.length).toBe(0); // no live turn per the spec's Errors column
  });

  it("refuses the unimplemented gdpr-subject-rights purpose rather than running the wrong agent (FIND-SEC-P07)", async () => {
    await expect(
      startConversation({
        workerId: "worker-gdpr",
        purpose: "gdpr-subject-rights",
        context: {},
      }),
    ).rejects.toThrow(NotImplementedError);
  });

  it("rate-limits repeated conversation starts for the same worker (OD-CHAT-010)", async () => {
    for (let i = 0; i < 5; i += 1) {
      await startConversation({
        workerId: "worker-spammer",
        purpose: "onboarding-document-collection",
        context: { requiredDocuments: [] },
      });
    }
    await expect(
      startConversation({
        workerId: "worker-spammer",
        purpose: "onboarding-document-collection",
        context: { requiredDocuments: [] },
      }),
    ).rejects.toThrow(RateLimitError);
  });
});

describe("outcome disclosure is minimized (FIND-SEC-P02)", () => {
  beforeEach(reset);

  it("returns only status/fallbackReason across module boundaries — never the transcript", async () => {
    const conversation = await startConversation({
      workerId: "worker-4",
      purpose: "onboarding-document-collection",
      context: { requiredDocuments: [{ name: "Passport", present: false }] },
    });

    const outcome = getConversationOutcomeInProcess(conversation.id);
    expect(outcome).toEqual({ id: conversation.id, status: "in-progress" });
    expect(outcome).not.toHaveProperty("messages");
    expect(outcome).not.toHaveProperty("workerId");

    const workerView = getConversationOutcome(conversation.id, "worker-4");
    expect(workerView).not.toHaveProperty("messages");
  });

  it("hands out a copy, not the live stored object, on the full-record path", async () => {
    const conversation = await startConversation({
      workerId: "worker-5",
      purpose: "onboarding-document-collection",
      context: { requiredDocuments: [] },
    });

    const record = getConversationRecordInProcess(conversation.id)!;
    record.workerId = "attacker";
    expect(getConversationRecordInProcess(conversation.id)!.workerId).toBe("worker-5");
  });
});
