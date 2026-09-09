import type { CompactResult } from '../tools/registry.js';

/**
 * Deterministic response rendering.
 *
 * For a structured read, a second model call to write prose is strictly worse
 * on all three axes: it doubles tokens and latency, and it adds a surface
 * where the model can describe a shift that is not in the result set. The
 * tool already returned exactly the facts; rendering them is string work.
 *
 * Free-text synthesis is reserved for L3, where the question genuinely needs
 * reasoning over multiple results.
 */

export function renderToolResult(result: CompactResult): string {
  return result.summary;
}

export function renderBudgetFallback(reason: string): string {
  // Deliberately does not blame the worker or expose the cap's value.
  switch (reason) {
    case 'conversation-cap-exhausted':
      return 'This conversation has reached its limit. Please use the checklist to continue.';
    case 'daily-user-cap-exhausted':
      return 'You have reached today’s assistant limit. Please use the checklist to continue.';
    default:
      return 'The assistant is unavailable right now. Please use the checklist to continue.';
  }
}

export function renderProviderUnavailable(): string {
  return 'The assistant cannot answer free-text questions right now. You can still use the quick commands.';
}

export function renderDenied(): string {
  // One message for every denial reason: which specific gate refused is not
  // something the caller should be able to probe for.
  return 'You do not have access to that.';
}

export function renderUnrecognized(): string {
  return 'I did not understand that. Try one of the quick commands.';
}


/**
 * What the user is asked to approve.
 *
 * Rendered DETERMINISTICALLY from the same parsed arguments the confirmation
 * token hashes -- never phrased by a second model call. That equality is
 * what makes the confirmation meaningful: whatever a person reads here is
 * exactly what the token authorises, so an argument cannot change between
 * the sentence they approved and the call that runs.
 *
 * Arguments are listed rather than summarised in prose. A prose summary
 * would have to omit something to stay readable, and the omitted field is
 * precisely where a substituted value would hide.
 */
/**
 * Human labels for the argument keys a confirmation shows.
 *
 * The keys are internal names; the person approving is a hotel manager on a
 * phone. `worker_name` and `day` mean nothing to them, and the production
 * screen of 2026-09-10 showed exactly that, under the heading
 * `This will run: assignments.place_worker`.
 *
 * Anything not listed falls back to the key with underscores removed, so a
 * new argument degrades to something readable rather than disappearing --
 * which matters, because EVERY argument must stay visible (see below).
 */
const ARG_LABELS: Record<string, string> = {
  worker_name: 'Worker',
  hotel_name: 'Hotel',
  day: 'Day',
  from: 'From',
  to: 'To',
  kind: 'Type',
  reason: 'Reason',
  status: 'Status',
  position: 'Position',
  workers_needed: 'Workers needed',
  shift_date: 'Date',
  shift_start_time: 'Starts',
  shift_end_time: 'Ends',
  room_number: 'Room',
  note: 'Note',
  notes: 'Note',
  dataset: 'Data',
  format: 'Format',
  staff_type: 'Staff type',
  count: 'Count',
};

/**
 * What each tool is about to do, in the words of the person approving it.
 *
 * A tool NAME is not an answer to "what am I agreeing to". Anything missing
 * from this map falls back to a plain sentence built from the tool's own
 * name, so an unmapped tool still never prints a dotted identifier.
 */
const TOOL_ACTIONS: Record<string, string> = {
  'assignments.place_worker': 'Put a worker on the schedule',
  'assignments.place_many': 'Put several workers on the schedule',
  'assignments.complete_my_shift': 'Mark your shift complete',
  'calendar.mark_worker_absence': 'Record a worker as away',
  'calendar.mark_my_absence': 'Record you as away',
  'calendar.withdraw_my_absence': 'Cancel your day off',
  'quality.assign_rework': 'Send a room back for rework',
  'employees.approve_application': 'Approve a job application',
  'employees.reject_application': 'Reject a job application',
  'employees.assign_to_hotel': 'Assign an employee to a hotel',
  'job_requests.accept': 'Accept an open shift',
  'job_requests.create_broadcast': 'Draft a staffing request',
  'reports.export_team': 'Export a team report',
  'reports.export_my_data': 'Export your own data',
  'attendance.check_in': 'Clock you in',
  'attendance.check_out': 'Clock you out',
  'rooms.log_cleaned': 'Log a room as cleaned',
  'hr.request_payslip': 'Request your payslip',
  'notifications.mark_read': 'Mark a message as read',
};

/** "assignments.place_worker" -> "Place worker", as a last resort. */
function describeToolAction(toolName: string): string {
  const mapped = TOOL_ACTIONS[toolName];
  if (mapped) return mapped;
  const tail = toolName.includes('.') ? toolName.slice(toolName.indexOf('.') + 1) : toolName;
  const words = tail.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * What the user is asked to approve.
 *
 * Rendered DETERMINISTICALLY from the same parsed arguments the confirmation
 * token hashes -- never phrased by a second model call. That equality is
 * what makes the confirmation meaningful: whatever a person reads here is
 * exactly what the token authorises, so an argument cannot change between
 * the sentence they approved and the call that runs.
 *
 * EVERY ARGUMENT IS STILL LISTED, and that has not changed. A prose summary
 * would have to omit something to stay readable, and the omitted field is
 * precisely where a substituted value would hide. What changed on
 * 2026-09-10 is only the WORDS AROUND the values: a manager was shown
 *
 *     This will run: assignments.place_worker
 *       worker_name: worker 1
 *       day: 2023-04-10
 *
 * which names an internal tool, uses internal keys, and reads like a stack
 * trace. The values are identical in both versions; only the labels differ,
 * so the property above is untouched while the screen becomes something a
 * person on a phone can actually check.
 */
export function renderConfirmationRequest(toolName: string, args: unknown): string {
  const entries =
    args && typeof args === 'object' && !Array.isArray(args)
      ? Object.entries(args as Record<string, unknown>)
      : [];

  const lines = entries
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      const label = ARG_LABELS[key] ?? key.replace(/_/g, ' ');
      const shown = typeof value === 'string' ? value : JSON.stringify(value);
      return `  ${label}: ${shown}`;
    });

  return [
    `${describeToolAction(toolName)}:`,
    ...(lines.length > 0 ? lines : ['  (nothing to change)']),
    '',
    'Nothing has been changed yet. Confirm to go ahead, or cancel.',
  ].join('\n');
}

/**
 * Strip anything that names the internal tool surface out of free model text.
 *
 * FOUND IN PRODUCTION 2026-09-10. Asked "what are the options", the assistant
 * answered a hotel manager with a numbered list of `assignments.list_for_my_team`,
 * `attendance.team_status` and `calendar.check_availability` -- identifiers the
 * person cannot type, does not recognise, and was never meant to see.
 *
 * The system prompt now tells the model not to do this, but a prompt is a
 * cooperation aid, not a control (`router-l1.ts` says so about its own
 * authorization rules, for the same reason). This is the control: it runs on
 * the model's text regardless of what the model intended, so a leak requires
 * the redaction to fail rather than the model to behave.
 *
 * WHAT IT DOES NOT DO: invent a replacement. A tool name is removed and the
 * sentence around it is left alone, because guessing the phrase the model
 * "meant" would put words in its mouth that no tool result supports. If the
 * removal leaves the reply empty or meaningless, the caller falls back to the
 * unrecognised-input text, which at least tells the truth.
 */
export function redactToolNames(text: string, toolNames: readonly string[]): string {
  if (!text) return text;

  let out = text;
  for (const name of toolNames) {
    // Escaped: tool names contain dots, which are regex wildcards -- and a
    // wildcard here would match far more than the name.
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Optional surrounding backticks: the model formats them as code, and
    // leaving an empty `` pair behind looks like a rendering bug.
    out = out.replace(new RegExp('`?' + escaped + '`?', 'g'), 'that');
  }

  // "Use that – shows all shifts" reads badly but honestly; collapse the
  // whitespace the removals leave behind rather than the meaning.
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}
