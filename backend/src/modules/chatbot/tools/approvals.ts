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

/**
 * The third batch, 2026-09-09: the planning tools.
 *
 * Commissioned in the same instruction that approved them -- "fix the genuine
 * gaps. and build tools from the absent list that you think are worth
 * building" -- after a route-by-route gap analysis of all 88 platform routes
 * against the then-31-tool registry was put to the commissioning human.
 *
 * The selection was delegated; the SCOPE limits above are not. Each of the
 * four wraps a read or a draft-only write inside the caller's existing scope,
 * which is what was described when the delegation was given. None of them
 * relaxes one of the capabilities that analysis recorded as deliberately
 * refused -- credentials, role and identity mutation, consent, subject-rights
 * exports, org-structure surgery, bulk import, the leaderboard's known
 * authorization gap, the audit log, operator internals, location history, or
 * manager timesheet correction. Those stay refused, and adding any of them
 * would need its own decision rather than this one.
 */
export const APPROVED_2026_09_09_PLANNING =
  'APPROVED 2026-09-09 by the commissioning human under ADR-053 item 4, as the ' +
  'planning batch (availability, staffing broadcasts, team attendance, team roster). ' +
  'Covers this tool as registered on that date; a later change to its scope, ' +
  'risk tier or permission requires re-approval.';

/**
 * THE DAILY SHIFT SUMMARY, approved 2026-09-12 on a direct instruction.
 *
 * Two transcripts were supplied with the request -- an admin's and a
 * manager's -- both refusing the same sentence ("we have 90 rooms to clean
 * ... and 10 blibe"), and the instruction was: "fix it and build their tools
 * and integrate properly." That is an explicit approval of THESE two
 * capabilities, and of nothing beyond them.
 *
 * WHAT IT COVERS. Reading and writing one hotel-day's `DailyShiftSummary`:
 * the four counts and the note the calendar's day view already edits through
 * `ShiftSummaryPanel`, for the same three roles the route has always allowed
 * (admin, regional_manager, manager) over the same hotels each of them
 * already covers. No new data, no new audience, no widened scope -- the
 * assistant is being given a surface the web app has had since 2026-08.
 *
 * WHY THE WRITE IS UNCONFIRMED, which is the only judgment call in it. It
 * changes four integers and a note on a single hotel-day; it notifies nobody,
 * pays nobody, and is corrected by saying the right number. The one way it
 * could destroy work -- a partial sentence writing zeros over counts it was
 * not told about, which the route's all-fields-required body invites -- is
 * closed in the tool itself by merging into the stored row. A confirmation
 * step would have made the assistant slower than the form it exists to
 * replace, for a write that is cheaper to fix than to confirm.
 *
 * NOT COVERED, and unchanged by this: the summary is the day's PLAN. Nothing
 * here places a worker, alters attendance, or marks a room cleaned, and a
 * later change to either tool's scope, risk tier or permission needs its own
 * approval rather than this one.
 */
export const APPROVED_2026_09_12_SHIFT_SUMMARY =
  'APPROVED 2026-09-12 by the commissioning human under ADR-053 item 4, on the ' +
  'transcripts showing both an admin and a manager refused when asked to record ' +
  "the day's room counts. Covers reading and writing one hotel-day's daily shift " +
  'summary, for the roles and hotels the existing route already allows; a later ' +
  'change to scope, risk tier or permission requires re-approval.';
