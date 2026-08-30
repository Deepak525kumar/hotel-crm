import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { CreateQualityVerificationSchema } from '../modules/quality/types.js';

// CRR §14 rework loop + ADR-069 (rework is a NEW linked assignment).
//
// The escalation job is tested here too, because its idempotence is the part
// most likely to regress: the scheduler re-runs every tick, so a missing claim
// would re-notify the manager and checker forever rather than once.

jest.mock('../lib/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockEnqueue = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
jest.mock('../modules/notifications/service.js', () => ({
  notificationService: { enqueue: (...a: unknown[]) => mockEnqueue(...a) },
}));

import { ReworkEscalationJob, REWORK_DEADLINE_MS } from '../modules/quality/rework-escalation-job.js';

describe('REWORK_DEADLINE_MS', () => {
  it('is the 20 minutes CRR §14 specifies', () => {
    expect(REWORK_DEADLINE_MS).toBe(20 * 60 * 1000);
  });
});

// The job scans ReworkRound, not QualityVerification, since 2026-08-30: a room
// can be sent back more than once, and a single escalated_at on the check
// cannot express "round 1 escalated, round 2 has not".
function makePrisma(overdue: any[]) {
  const updateMany = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
  updateMany.mockResolvedValue({ count: 1 });
  const verificationUpdateMany = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
  verificationUpdateMany.mockResolvedValue({ count: 1 });
  const findMany = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
  findMany.mockResolvedValue(overdue);
  const tx = {
    reworkRound: { updateMany },
    qualityVerification: { updateMany: verificationUpdateMany },
  };
  return {
    prisma: {
      reworkRound: { findMany },
      $transaction: (fn: any) => fn(tx),
    } as any,
    findMany,
    updateMany,
    verificationUpdateMany,
  };
}

const overdueRow = {
  id: 'round1',
  round_number: 1,
  verification: {
    id: 'v1',
    hotel_id: 'h1',
    verified_by_id: 'checker1',
    room_number: '412',
    assignment: { worker_id: 'w1', hotel_id: 'h1' },
    hotel: { manager_user_id: 'mgr1' },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEnqueue.mockResolvedValue(undefined);
});

describe('ReworkEscalationJob', () => {
  it('notifies BOTH the checker and the manager (CRR §14 says both)', async () => {
    const { prisma } = makePrisma([overdueRow]);
    await new ReworkEscalationJob(prisma, { intervalMs: 1000 }).run();

    const recipients = mockEnqueue.mock.calls.map((c: any[]) => c[0].recipientId).sort();
    expect(recipients).toEqual(['checker1', 'mgr1']);
    expect(mockEnqueue.mock.calls[0][0].type).toBe('REWORK_OVERDUE');
  });

  it('claims the row before notifying, so it can escalate only once', async () => {
    const { prisma, updateMany } = makePrisma([overdueRow]);
    await new ReworkEscalationJob(prisma, { intervalMs: 1000 }).run();

    // The claim is a conditional update -- a compare-and-swap, not a blind
    // write -- and it re-checks BOTH conditions, not just the escalation
    // marker.
    //
    // rework_completed_at is deliberately re-stated here even though the
    // findMany already filtered on it: the select and this claim are
    // separated by the batch loop (up to batchSize rows, one transaction
    // each), so a worker can finish their rework in between. Claiming on
    // rework_escalated_at alone would still succeed and tell the manager AND
    // checker that work is overdue seconds after it was completed -- a false
    // 20-minute alarm, which is how people learn to ignore the real ones.
    const where = updateMany.mock.calls[0][0].where;
    expect(where).toEqual({
      id: 'round1',
      escalated_at: null,
      completed_at: null,
      // A round cancelled after three days is closed; escalating it would
      // chase work that has already been written off.
      cancelled_at: null,
    });
    expect(updateMany.mock.calls[0][0].data.escalated_at).toBeInstanceOf(Date);
  });

  it('sends nothing when the worker completed between the select and the claim', async () => {
    // The race itself, not just the query shape: findMany saw an incomplete
    // rework, the worker finished it, and the conditional claim now matches
    // zero rows -- so no overdue notification is sent.
    const { prisma, updateMany } = makePrisma([overdueRow]);
    updateMany.mockResolvedValue({ count: 0 });
    await new ReworkEscalationJob(prisma, { intervalMs: 1000 }).run();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('sends NOTHING when another process already claimed the row', async () => {
    const { prisma, updateMany } = makePrisma([overdueRow]);
    updateMany.mockResolvedValue({ count: 0 }); // lost the race
    await new ReworkEscalationJob(prisma, { intervalMs: 1000 }).run();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('still notifies the checker when the hotel has no manager', async () => {
    // An escalation that cannot reach one party must still reach the other.
    const { prisma } = makePrisma([{ ...overdueRow, verification: { ...overdueRow.verification, hotel: { manager_user_id: null } } }]);
    await new ReworkEscalationJob(prisma, { intervalMs: 1000 }).run();
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue.mock.calls[0][0].recipientId).toBe('checker1');
  });

  it('does not notify the same person twice when checker IS the manager', async () => {
    const { prisma } = makePrisma([{ ...overdueRow, verification: { ...overdueRow.verification, hotel: { manager_user_id: 'checker1' } } }]);
    await new ReworkEscalationJob(prisma, { intervalMs: 1000 }).run();
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it('only selects rework that is required, incomplete and not yet escalated', async () => {
    const { prisma, findMany } = makePrisma([]);
    await new ReworkEscalationJob(prisma, { intervalMs: 1000 }).run();
    const where = findMany.mock.calls[0][0].where;
    // Scoped to OPEN rounds, past the deadline, not yet escalated. The old
    // query keyed off the verification and `rework_assignments: { some: ... }`,
    // which round 1's long-finished shift satisfies forever -- so opening
    // round 2 would have escalated it instantly.
    expect(where.completed_at).toBeNull();
    expect(where.escalated_at).toBeNull();
    expect(where.cancelled_at).toBeNull();
    // Measured from when the clock STARTED, not when the round was assigned
    // (owner decision, 2026-08-30). A round raised against a finished shift
    // has timer_started_at NULL, and `{ lte }` never matches NULL -- so it
    // cannot escalate until the worker checks in and the clock is set.
    expect(where.timer_started_at.lte).toBeInstanceOf(Date);
    expect(where.assigned_at).toBeUndefined();
  });

  it('one failing row does not abort the batch', async () => {
    const { prisma } = makePrisma([
      overdueRow,
      { ...overdueRow, id: 'round2', verification: { ...overdueRow.verification, id: 'v2' } },
    ]);
    mockEnqueue.mockRejectedValueOnce(new Error('boom'));
    await expect(
      new ReworkEscalationJob(prisma, { intervalMs: 1000 }).run()
    ).resolves.toBeUndefined();
    // v2 still got its notifications after v1 threw.
    const ids = mockEnqueue.mock.calls.map((c: any[]) => c[0].data.verification_id);
    expect(ids).toContain('v2');
  });
});

// The two check-then-act races in the service. Both were real: the read that
// guards them happens outside the transaction, so two concurrent callers can
// both observe the "not yet" state. Both are now compare-and-swap claims, the
// same pattern the password-reset fix uses.
// Owner decision, 2026-08-29: rework is the CHECKER's call, not the score's.
// assignRework used to refuse a PASSED verification, which made the action a
// function of the number typed on the previous screen -- a checker who scored
// a room 75 and then saw something that had to be redone could not say so.
describe('rework is the checker’s decision, not an inference from the score', () => {
  const body = () => {
    const src = readFileSync('src/modules/quality/service.ts', 'utf8');
    return src.slice(src.indexOf('async assignRework('), src.indexOf('async completeRework('));
  };

  it('does not refuse a PASSED verification', () => {
    // The specific guard that was removed. Asserted on its message rather than
    // on the absence of the word PASSED, because the method legitimately still
    // references VerificationStatus when it writes NEEDS_REWORK below.
    expect(body()).not.toContain('Cannot assign rework for a passed inspection');
  });

  it('gates on nothing derived from score at all', () => {
    // A re-introduced gate would most likely come back as a threshold
    // comparison or a status equality check on the way in.
    expect(body()).not.toMatch(/status === VerificationStatus\.PASSED/);
    expect(body()).not.toMatch(/score\s*>=\s*\d+/);
  });

  it('writes NEEDS_REWORK so the record cannot contradict the decision', () => {
    // Otherwise a row says PASSED while carrying a rework assignment: a green
    // badge next to "awaiting the worker" on both evidence screens, and
    // analytics (which filters on `status: PASSED`) still counting it as a
    // pass after the checker said it is not one.
    expect(body()).toContain('status: VerificationStatus.NEEDS_REWORK');
  });

  it('leaves the score itself untouched', () => {
    // The number the checker gave is still the number they gave, and it feeds
    // WorkerOverallRating. Only the OUTCOME is overridden by the decision.
    expect(body()).not.toMatch(/data:\s*\{[^}]*\bscore:/s);
  });
});

describe('rework claims are compare-and-swap, not check-then-act', () => {
  it('assignRework claims on rework_required === false', () => {
    const src = readFileSync('src/modules/quality/service.ts', 'utf8');
    const body = src.slice(src.indexOf('async assignRework('), src.indexOf('async completeRework('));
    // The WHERE must constrain the prior state; a bare id would let both
    // concurrent callers win and create two rework rows -- and therefore two
    // 20-minute escalation timers for one failure.
    expect(body).toContain('rework_required: false');
    expect(body).toContain('updateMany');
    expect(body).toContain('claimed.count === 0');
  });

  it('completeRework claims THE ROUND, not the check', () => {
    const src = readFileSync('src/modules/quality/service.ts', 'utf8');
    const body = src.slice(src.indexOf('async completeRework('));
    // Without a claim, two interleaved requests both append and the checker is
    // notified twice for one upload.
    //
    // The claim targets the round -- located by the shift the worker is
    // standing in, which belongs to exactly one round -- rather than the
    // check's flat rework_completed_at, which cannot tell round 2 from round 1
    // and would refuse a legitimate second round outright.
    expect(body).toMatch(/reworkRound\.updateMany\(\s*\{\s*where: \{ id: existing\.id/);
    expect(body).toMatch(/findFirst\(\{\s*where: \{ assignment_id: assignmentId/);
    expect(body).toContain('claimedRound.count === 0');
  });

  it('lets a worker submit again instead of refusing with "already completed"', () => {
    // Reported from the app: a worker who uploaded the wrong photo, or was
    // asked for another, tapped "mark as done" and got "This rework has
    // already been completed" with no way forward.
    //
    // The old claim was `completed_at: null`, which cannot tell a deliberate
    // re-submission from a double-tap, so it refused both. An optimistic lock
    // on updated_at separates them: two interleaved requests read the same
    // value and only one matches, while a submission made later reads the new
    // value and succeeds.
    const src = readFileSync('src/modules/quality/service.ts', 'utf8');
    const body = src.slice(src.indexOf('async completeRework('), src.indexOf('async assertCanInspect'));
    expect(body).toMatch(/updated_at: existing\.updated_at/);
    expect(body).not.toMatch(/reworkRound\.updateMany\(\{\s*where: \{ assignment_id: assignmentId, completed_at: null \}/);
  });

  it('keeps the FIRST completion time when more evidence is added', () => {
    // Overwriting it would restart the story of when the room was reported
    // done, and the 20-minute escalation reads that moment.
    const src = readFileSync('src/modules/quality/service.ts', 'utf8');
    const body = src.slice(src.indexOf('async completeRework('), src.indexOf('async assertCanInspect'));
    expect(body).toMatch(/completed_at: existing\.completed_at \?\? completedAt/);
  });

  it('does not re-complete the shift when evidence is added later', () => {
    // Re-stamping the assignment's completed_at on every upload would keep
    // moving the moment the shift finished.
    const src = readFileSync('src/modules/quality/service.ts', 'utf8');
    const body = src.slice(src.indexOf('async completeRework('), src.indexOf('async assertCanInspect'));
    const guard = body.indexOf('if (!existing.completed_at)');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf('AssignmentStatus.COMPLETED'));
  });

  it('only mirrors completion when the round is the NEWEST', () => {
    // Adding a photo to round 1 while round 2 is open must not mark the check
    // complete: the mirror describes the newest round, and that one is still
    // outstanding.
    const src = readFileSync('src/modules/quality/service.ts', 'utf8');
    const body = src.slice(src.indexOf('async completeRework('), src.indexOf('async assertCanInspect'));
    expect(body).toMatch(/if \(isNewest\) \{[\s\S]*?rework_completed_at/);
  });

  it('completeRework stores the evidence ON the round, not in the check’s photos', () => {
    // The defect this whole model exists to fix: the worker's proof of the fix
    // was appended into the SAME photo_urls array as the checker's original
    // photographs, so the checker saw one flat grid and could not tell which
    // pictures showed the room fixed.
    const src = readFileSync('src/modules/quality/service.ts', 'utf8');
    const body = src.slice(src.indexOf('async completeRework('), src.indexOf('async assertCanInspect'));
    expect(body).toMatch(/reworkRound\.updateMany\([\s\S]*?photo_urls: \{ push: photoKeys \}/);
    // ...and NOT onto the verification.
    const vUpdate = body.slice(body.indexOf('qualityVerification.updateMany'));
    expect(vUpdate.slice(0, vUpdate.indexOf('});'))).not.toContain('photo_urls');
  });

  it('the rework notification carries the notes the mobile deep link reads', () => {
    // The worker taps the push and lands on /rework/:id?notes=... -- the note
    // IS the instruction, so it must be in the payload or the screen opens
    // blank and the worker has to go hunting with a 20-minute clock running.
    const src = readFileSync('src/modules/quality/service.ts', 'utf8');
    const body = src.slice(src.indexOf('async assignRework('), src.indexOf('async completeRework('));
    expect(body).toContain('rework_assignment_id: reworkAssignment.id');
    expect(body).toContain('notes: input.notes');
  });
});

// ADR-069 §3 applied consistently. Both ratio numerators must carry the same
// rework exclusion as the shared denominator, or completing a rework moves a
// numerator that the denominator does not -- which is exactly how on_time_rate
// came to exceed 100% before the 2026-08-18 fix.
describe('rework exclusion is applied to BOTH numerators, not just the denominator', () => {
  const src = () => readFileSync('src/modules/quality/service.ts', 'utf8');

  it('the completion_rate numerator excludes rework', () => {
    // Scenario this guards: worker completes an assignment (1/1 = 100%), fails
    // inspection, completes the rework. Rework is out of the denominator, so
    // an unfiltered numerator gives 2/1 = 200%.
    const body = src().slice(
      src().indexOf('const dueAssignmentWhere'),
      src().indexOf('const averageScore')
    );
    const completedCount = body.slice(body.indexOf('status: AssignmentStatus.COMPLETED'));
    expect(completedCount.slice(0, 200)).toContain('rework_of_assignment_id: null');
  });

  it('the on_time_rate numerator inherits the exclusion via dueAssignmentWhere', () => {
    const body = src();
    const attendance = body.slice(body.indexOf('tx.attendance.count('));
    expect(attendance.slice(0, 300)).toContain('assignment: dueAssignmentWhere');
  });

  it('the denominator itself excludes rework', () => {
    const body = src().slice(src().indexOf('const dueAssignmentWhere'));
    expect(body.slice(0, 900)).toContain('rework_of_assignment_id: null');
  });
});

// Found only by a real multipart request. Every multipart field arrives as a
// STRING, so a plain z.number() rejected score="50" with "Expected number,
// received string" -- the endpoint was broken for every real client,
// including this repo's own web form, which sends String(score). The unit
// tests all passed because they call the service directly with a number.
describe('verification score accepts a multipart string', () => {
  it('coerces "50" the way a multipart body sends it', () => {
    const parsed = CreateQualityVerificationSchema.safeParse({
      assignment_id: 'a1',
      room_number: '412',
      score: '50',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.score).toBe(50);
  });

  it('still accepts a plain number from a JSON caller', () => {
    const parsed = CreateQualityVerificationSchema.safeParse({
      assignment_id: 'a1',
      room_number: '412',
      score: 50,
    });
    expect(parsed.success).toBe(true);
  });

  it.each(['abc', '50.5', '-1', '101'])('still rejects %s', (score) => {
    // Coercion must not become "accept anything": .int() and the bounds still
    // apply after the string is converted.
    expect(
      CreateQualityVerificationSchema.safeParse({ assignment_id: 'a1', score }).success
    ).toBe(false);
  });
});
