/**
 * TOOL APPROVALS under `ADR-053` item 4.
 *
 * The ADR approves the registry ARCHITECTURE and explicitly not any specific
 * tool: "each tool integration is its own explicit future approval".
 * `OD-CHAT-013` assigns that authority to the commissioning human.
 *
 * Constants live here rather than being restated per file so the wording of an
 * approval cannot drift between tool families, and so the scope limits below
 * are stated once and apply everywhere they are cited.
 *
 * SCOPE OF ANY APPROVAL HERE, stated precisely because a blanket reading would
 * hollow out the control it satisfies:
 *
 *   - It covers the tools that carried it ON THE DATE GIVEN, and the capability
 *     each wrapped at that time.
 *   - It is NOT standing authority for tools added afterwards. Those register
 *     as PENDING and need their own decision, which is the whole point of
 *     item 4.
 *   - It does NOT survive a change to what an approved tool does. Widening a
 *     tool's scope, risk tier or permission makes it a different capability
 *     from the one approved, and returns it to PENDING.
 *
 * `assertAllToolsApproved()` refuses to boot with any PENDING tool registered
 * while `FEATURE_CHATBOT` is on, so this is enforced rather than remembered.
 */

/** The first batch: the thirteen tools registered on 2026-09-08. */
export const APPROVED_2026_09_08 =
  'APPROVED 2026-09-08 by the commissioning human under ADR-053 item 4. ' +
  'Covers this tool as registered on that date; a later change to its scope, ' +
  'risk tier or permission requires re-approval.';

/**
 * The second batch, 2026-09-09: the shift, reporting, broadcast, team-management
 * and self-care tools.
 *
 * Granted after the registry had grown from thirteen to thirty-one, and after
 * the tool-design rules (descriptions, least privilege, deterministic
 * enforcement, capability boundaries, semantic validation, structured failures
 * and refusals, ambiguity) were made mechanical rather than conventional --
 * every tool below passes that suite, which is what made a batch approval
 * defensible rather than a leap.
 */
export const APPROVED_2026_09_09 =
  'APPROVED 2026-09-09 by the commissioning human under ADR-053 item 4. ' +
  'Covers this tool as registered on that date, after it passed the full ' +
  'tool-design rule suite; a later change to its scope, risk tier or ' +
  'permission requires re-approval.';
