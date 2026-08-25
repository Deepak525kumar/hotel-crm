import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/server.js";
import { config } from "../src/config.js";
import { store } from "../src/store.js";
import { budgetGuard } from "../src/budgetGuard.js";
import { __resetRateLimitsForTests } from "../src/rateLimiter.js";

const AUTH = `Bearer ${config.internalCallerToken}`;

beforeEach(() => {
  store.clear();
  budgetGuard.__resetForTests();
  __resetRateLimitsForTests();
});

describe("HTTP surface guardrails", () => {
  it("rejects /internal/* calls without the internal caller token", async () => {
    const res = await request(app).post("/internal/conversations").send({
      workerId: "worker-1",
      purpose: "onboarding-document-collection",
      context: {},
    });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong-length and a same-length-but-wrong internal token", async () => {
    const short = await request(app).post("/internal/conversations").set("Authorization", "Bearer short").send({});
    expect(short.status).toBe(401);

    const sameLength = "0".repeat(config.internalCallerToken.length);
    const res = await request(app)
      .post("/internal/conversations")
      .set("Authorization", `Bearer ${sameLength}`)
      .send({ workerId: "w", purpose: "onboarding-document-collection", context: {} });
    expect(res.status).toBe(401);
  });

  it("rejects worker-facing calls without the x-worker-id header (stub auth)", async () => {
    const res = await request(app).get("/conversations/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(401);
  });

  it("rejects malformed StartConversation payloads with 400, not 500", async () => {
    const res = await request(app)
      .post("/internal/conversations")
      .set("Authorization", AUTH)
      .send({ workerId: "worker-1", purpose: "not-a-real-purpose", context: {} });
    expect(res.status).toBe(400);
  });

  it("does not echo the submitted value back in validation errors (FIND-SEC-P14)", async () => {
    const res = await request(app)
      .post("/internal/conversations")
      .set("Authorization", AUTH)
      .send({ workerId: "worker-1", purpose: "secret-probe-value", context: {} });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain("secret-probe-value");
  });

  it("rejects an unknown field on the worker message body (strict schema)", async () => {
    const start = await request(app)
      .post("/internal/conversations")
      .set("Authorization", AUTH)
      .send({
        workerId: "worker-strict",
        purpose: "onboarding-document-collection",
        context: { requiredDocuments: [{ name: "Passport", present: false }] },
      });

    // submittedDocuments no longer exists on the wire — the worker cannot
    // assert their own completeness (FIND-SEC-P01).
    const res = await request(app)
      .post(`/conversations/${start.body.id}/messages`)
      .set("x-worker-id", "worker-strict")
      .send({ message: "here", submittedDocuments: ["Passport"] });
    expect(res.status).toBe(400);
  });

  it("refuses the gdpr-subject-rights purpose with 501", async () => {
    const res = await request(app)
      .post("/internal/conversations")
      .set("Authorization", AUTH)
      .send({ workerId: "worker-gdpr", purpose: "gdpr-subject-rights", context: {} });
    expect(res.status).toBe(501);
  });

  it("mode (b) returns only the outcome, never the transcript", async () => {
    const start = await request(app)
      .post("/internal/conversations")
      .set("Authorization", AUTH)
      .send({
        workerId: "worker-min",
        purpose: "onboarding-document-collection",
        context: { requiredDocuments: [{ name: "Passport", present: false }] },
      });

    const outcome = await request(app).get(`/internal/conversations/${start.body.id}`).set("Authorization", AUTH);
    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ id: start.body.id, status: "in-progress" });
    expect(outcome.body).not.toHaveProperty("messages");
  });

  it("runs the full path: start, converse, trusted-tier refresh completes it, self-scoped throughout", async () => {
    const start = await request(app)
      .post("/internal/conversations")
      .set("Authorization", AUTH)
      .send({
        workerId: "worker-http",
        purpose: "onboarding-document-collection",
        context: { requiredDocuments: [{ name: "Passport", present: false }] },
      });
    expect(start.status).toBe(201);
    const conversationId = start.body.id;

    const exchange = await request(app)
      .post(`/conversations/${conversationId}/messages`)
      .set("x-worker-id", "worker-http")
      .send({ message: "just sent it over" });
    expect(exchange.status).toBe(200);
    expect(exchange.body.status).toBe("in-progress"); // worker's word alone does not complete it

    const refresh = await request(app)
      .post(`/internal/conversations/${conversationId}/refresh`)
      .set("Authorization", AUTH)
      .send({ presentDocumentNames: ["Passport"] });
    expect(refresh.status).toBe(200);
    expect(refresh.body.status).toBe("completed");

    const poll = await request(app).get(`/conversations/${conversationId}`).set("x-worker-id", "worker-http");
    expect(poll.body.status).toBe("completed");

    const intruderPoll = await request(app)
      .get(`/conversations/${conversationId}`)
      .set("x-worker-id", "someone-else");
    expect(intruderPoll.status).toBe(403);

    // The refresh route is trusted-tier only — a worker cannot reach it.
    const workerRefresh = await request(app)
      .post(`/internal/conversations/${conversationId}/refresh`)
      .set("x-worker-id", "worker-http")
      .send({ presentDocumentNames: ["Passport"] });
    expect(workerRefresh.status).toBe(401);
  });
});
