import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TOOL_REGISTRY, resolveTool, validateToolInput, __defineToolForTests } from "../src/toolRegistry.js";

describe("tool registry (ADR-053)", () => {
  it("marks the irreversible tool as mandatory-confirmation", () => {
    expect(TOOL_REGISTRY.flag_for_manual_review.riskTier).toBe("high-risk-write");
    expect(TOOL_REGISTRY.flag_for_manual_review.requiresConfirmation).toBe(true);
  });

  it("resolves only allow-listed tool names", () => {
    expect(resolveTool("get_document_status")).toBeDefined();
    expect(resolveTool("drop_database")).toBeUndefined();
  });

  // FIND-SEC-P05: a plain object literal would resolve these truthy via the
  // prototype chain, sneaking past the allow-list check.
  it("does not resolve inherited Object.prototype members", () => {
    for (const inherited of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"]) {
      expect(resolveTool(inherited)).toBeUndefined();
    }
  });

  it("refuses to register a high-risk-write tool without confirmation (ADR-053 principle 5)", () => {
    expect(() =>
      __defineToolForTests({
        name: "dangerous",
        description: "x",
        riskTier: "high-risk-write",
        requiresConfirmation: false,
        inputSchema: { type: "object", properties: {}, required: [] },
        zodSchema: z.object({}),
        handler: () => null,
      }),
    ).toThrow(/must require confirmation/);
  });

  // FIND-SEC-P09: actor scope must come from ToolContext, never a model-fillable param.
  it("refuses to register a tool declaring an identity parameter (RULE-CHAT-09)", () => {
    expect(() =>
      __defineToolForTests({
        name: "sneaky_idor",
        description: "x",
        riskTier: "read-only",
        requiresConfirmation: false,
        inputSchema: { type: "object", properties: { workerId: { type: "string" } }, required: ["workerId"] },
        zodSchema: z.object({ workerId: z.string() }),
        handler: () => null,
      }),
    ).toThrow(/identity parameter/);
  });

  it("rejects tool input with an extra, unexpected field", () => {
    const tool = TOOL_REGISTRY.get_document_status;
    const result = validateToolInput(tool, { documentName: "Passport", extraField: "sneaky" });
    expect(result.ok).toBe(false);
  });

  it("rejects tool input missing a required field", () => {
    const tool = TOOL_REGISTRY.confirm_document_format;
    const result = validateToolInput(tool, { documentName: "Passport" });
    expect(result.ok).toBe(false);
  });

  it("accepts well-formed tool input", () => {
    const tool = TOOL_REGISTRY.get_document_status;
    const result = validateToolInput(tool, { documentName: "Passport" });
    expect(result.ok).toBe(true);
  });
});
