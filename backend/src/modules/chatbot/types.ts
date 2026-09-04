import { z } from 'zod';

/**
 * SPEC-CHATBOT-001 scaffold DTOs.
 *
 * Only the direct tool-invocation surface exists at this stage — there is no
 * conversation/message endpoint yet because no LLM provider is wired. This
 * lets the authorization boundary be exercised end-to-end (real JWT, real
 * services, real database) with zero AI in the loop, which is the whole point
 * of building the executor before the model.
 */

export const InvokeToolSchema = z
  .object({
    tool: z.string().min(1).max(100),
    // Untrusted by construction — validated against the tool's own strict
    // schema inside the executor, never trusted here.
    args: z.record(z.unknown()).default({}),
  })
  .strict();

export type InvokeToolInput = z.infer<typeof InvokeToolSchema>;

export interface ToolDescriptorDto {
  name: string;
  description: string;
  tier: string;
  confirm: boolean;
  interfaceRef: string;
  approvalRef: string;
}

export const StartConversationSchema = z
  .object({
    // Only the assistant purpose is startable by a worker's own client.
    // ONBOARDING_DOCUMENT_COLLECTION is consumer-triggered (in-process, from
    // Onboarding's own handler) and GDPR_SUBJECT_RIGHTS is Compliance's —
    // neither is a worker-selectable value, so neither is in this enum
    // (Security FIND-NEW-002: purpose must be chosen by the calling module's
    // own logic, never by the worker's client).
    purpose: z.literal('WORKFORCE_ASSISTANT').default('WORKFORCE_ASSISTANT'),
  })
  .strict();

export const ExchangeMessageSchema = z
  .object({
    text: z.string().min(1).max(4000).optional(),
    command_id: z.string().min(1).max(64).optional(),
    // A confirmation turn carries ONLY this: no text to re-parse and no
    // arguments to re-supply. The call being confirmed is held server-side
    // in session_state, so a client cannot alter what it is confirming --
    // the token merely proves this person saw and approved that exact call.
    confirm_token: z.string().min(1).max(2048).optional(),
  })
  .strict()
  .refine(
    (d) => [d.text, d.command_id, d.confirm_token].filter(Boolean).length === 1,
    {
    message: 'exactly one of text, command_id or confirm_token is required',
  });

export type StartConversationInput = z.infer<typeof StartConversationSchema>;
export type ExchangeMessageInput = z.infer<typeof ExchangeMessageSchema>;
