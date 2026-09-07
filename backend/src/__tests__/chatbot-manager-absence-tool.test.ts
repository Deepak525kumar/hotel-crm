import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * `calendar.mark_worker_absence` — a manager records a worker's sick or
 * vacation day.
 *
 * This is the half of the owner's motivating use case that was missing: a
 * manager dictating "Anna is off sick Monday, put Tomasz on Tuesday" could
 * only ever get the second clause done, because absence had a SELF path and
 * no on-behalf path.
 *
 * The properties under test are the ones that make a write on ANOTHER
 * person's record safe to expose to a model:
 *   - the worker is NAMED, never identified (no id may be an argument);
 *   - resolution happens inside the actor's own scope;
 *   - a worker's own declaration cannot be silently overwritten;
 *   - the population admitted matches the HTTP route exactly, checked
 *     against the real ROLE_PERMISSIONS rather than a fabricated fixture.
 */

const mockMarkForWorker = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockResolve = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockResolveHotel = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../modules/calendar/service.js', () => ({
  calendarService: {
    markAbsence: jest.fn(),
    markAbsenceForWorker: mockMarkForWorker,
  },
}));
jest.mock('../modules/chatbot/tools/worker-reference.js', () => ({
  resolveWorkerReference: mockResolve,
  resolveHotelReference: mockResolveHotel,
  describeUnresolved: (r: any) =>
    r.status === 'AMBIGUOUS'
      ? `More than one worker matches "${r.query}": ${(r.candidates ?? []).join(', ')}. Please use a fuller name.`
      : r.status === 'NO_SCOPE'
        ? 'This can only be done by a manager assigned to a specific hotel.'
        : `No worker matching "${r.query}" is on your team.`,
  describeUnresolvedHotel: (r: any) =>
    r.status === 'NEEDS_NAME'
      ? 'Which hotel? Please name it, since you cover more than one.'
      : `No hotel matching "${r.query}" is in your scope.`,
}));

import { markWorkerAbsence } from '../modules/chatbot/tools/definitions/self-service.tools.js';
import { actorHasPermission } from '../modules/chatbot/tools/executor.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const actorFor = (role: keyof typeof ROLE_PERMISSIONS): ActorContext =>
  ({
    userId: `u_${String(role)}`,
    role: String(role).toLowerCase(),
    permissions: ROLE_PERMISSIONS[role] ?? [],
    scope: { type: 'hotel', hotel_id: 'h1' },
  }) as unknown as ActorContext;

const VALID = { worker_name: 'Anna', day: '2026-09-10', kind: 'SICK' as const };

describe('calendar.mark_worker_absence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveHotel.mockResolvedValue({ status: 'RESOLVED', hotelId: 'h1', name: 'Premier Inn' });
    mockResolve.mockResolvedValue({
      status: 'RESOLVED',
      workerId: 'w1',
      fullName: 'Anna Schmidt',
      hotelId: 'h1',
    });
    mockMarkForWorker.mockResolvedValue({ id: 'ab1', day: '2026-09-10', kind: 'SICK' });
  });

  it('is a HIGH_RISK_WRITE that cannot skip confirmation', () => {
    // It commits another person's day, and the resulting row is protected
    // against later correction — so the actor must see the exact call first.
    expect(markWorkerAbsence.tier).toBe('HIGH_RISK_WRITE');
    expect(markWorkerAbsence.confirm).toBe(true);
  });

  it('takes a NAME and refuses every identifier form', () => {
    expect(markWorkerAbsence.args.safeParse(VALID).success).toBe(true);
    for (const bad of [
      { worker_id: 'w1', day: '2026-09-10', kind: 'SICK' },
      { ...VALID, workerId: 'w1' },
      { ...VALID, hotel_id: 'h1' },
      { ...VALID, userId: 'u1' },
      { ...VALID, role: 'admin' },
    ]) {
      expect(markWorkerAbsence.args.safeParse(bad).success).toBe(false);
    }
  });

  it('requires a reason for VACATION at proposal time, not after confirmation', () => {
    // The service enforces this too. Restating it in the schema means a
    // manager is never shown a summary, asked to confirm, and only then told
    // the call cannot run.
    expect(markWorkerAbsence.args.safeParse({ ...VALID, kind: 'VACATION' }).success).toBe(false);
    expect(
      markWorkerAbsence.args.safeParse({ ...VALID, kind: 'VACATION', reason: 'Family trip' })
        .success
    ).toBe(true);
    // A sick day needs none.
    expect(markWorkerAbsence.args.safeParse({ ...VALID, kind: 'SICK' }).success).toBe(true);
  });

  it('rejects a malformed day and an unknown kind rather than passing them through', () => {
    for (const day of ['10/09/2026', 'monday', '2026-9-1', '']) {
      expect(markWorkerAbsence.args.safeParse({ ...VALID, day }).success).toBe(false);
    }
    expect(markWorkerAbsence.args.safeParse({ ...VALID, kind: 'UNPAID' }).success).toBe(false);
  });

  it('records the absence for the resolved worker', async () => {
    const out = await markWorkerAbsence.invoke(
      markWorkerAbsence.args.parse(VALID) as never,
      actorFor('MANAGER')
    );

    expect(mockMarkForWorker).toHaveBeenCalledTimes(1);
    const [input] = mockMarkForWorker.mock.calls[0] as [Record<string, unknown>];
    // The id came from the RESOLVER, never from the arguments.
    expect(input.worker_id).toBe('w1');
    expect(input.day).toBe('2026-09-10');
    expect(input.kind).toBe('SICK');

    const summary = markWorkerAbsence.compress?.(out);
    expect(summary?.summary).toMatch(/recorded sick leave for Anna Schmidt on 2026-09-10/i);
  });

  it('omits `reason` entirely rather than sending undefined', async () => {
    await markWorkerAbsence.invoke(
      markWorkerAbsence.args.parse(VALID) as never,
      actorFor('MANAGER')
    );
    const [input] = mockMarkForWorker.mock.calls[0] as [Record<string, unknown>];
    expect('reason' in input).toBe(false);
  });

  it('refuses, rather than throwing, when the name matches more than one worker', async () => {
    mockResolve.mockResolvedValue({
      status: 'AMBIGUOUS',
      query: 'Anna',
      candidates: ['Anna Schmidt', 'Anna Weber'],
    });

    const out = await markWorkerAbsence.invoke(
      markWorkerAbsence.args.parse(VALID) as never,
      actorFor('MANAGER')
    );

    // "There are two Annas" is a normal answer a manager can act on.
    expect(mockMarkForWorker).not.toHaveBeenCalled();
    expect(markWorkerAbsence.compress?.(out).summary).toMatch(/more than one worker/i);
  });

  it('writes nothing when the worker is not in the actor\'s scope', async () => {
    // Out-of-scope is deliberately indistinguishable from non-existent, so a
    // manager cannot probe the roster of a hotel they do not run.
    mockResolve.mockResolvedValue({ status: 'NOT_FOUND', query: 'Anna' });

    const out = await markWorkerAbsence.invoke(
      markWorkerAbsence.args.parse(VALID) as never,
      actorFor('MANAGER')
    );

    expect(mockMarkForWorker).not.toHaveBeenCalled();
    expect(markWorkerAbsence.compress?.(out).summary).toMatch(/no worker matching/i);
  });

  it('asks which hotel instead of guessing one, for a multi-hotel actor', async () => {
    mockResolveHotel.mockResolvedValue({ status: 'NEEDS_NAME' });

    const out = await markWorkerAbsence.invoke(
      markWorkerAbsence.args.parse(VALID) as never,
      actorFor('ADMIN')
    );

    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockMarkForWorker).not.toHaveBeenCalled();
    expect(markWorkerAbsence.compress?.(out).summary).toMatch(/which hotel/i);
  });

  it('propagates the service\'s refusal to overwrite a self-marked absence', async () => {
    // The 2026-08-29 owner decision: a manager cannot re-kind or move an
    // absence the worker declared themselves. That guard lives in
    // markAbsenceForWorker and must NOT be swallowed here into a polite
    // summary — the turn fails and the manager is told.
    mockMarkForWorker.mockRejectedValue(new Error('Cannot change a self-marked absence'));

    await expect(
      markWorkerAbsence.invoke(markWorkerAbsence.args.parse(VALID) as never, actorFor('MANAGER'))
    ).rejects.toThrow(/self-marked/i);
  });

  it('leaks no identifier into what the model sees', async () => {
    const out = await markWorkerAbsence.invoke(
      markWorkerAbsence.args.parse(VALID) as never,
      actorFor('MANAGER')
    );
    const json = JSON.stringify(markWorkerAbsence.compress?.(out));
    for (const leak of ['w1', 'ab1', 'h1', 'worker_id']) {
      expect(json).not.toContain(leak);
    }
  });
});

/**
 * The admitted population must be exactly the one `POST /calendar/absences`
 * admits — checked against the REAL permission sets, because a tool gated on
 * a token its intended role does not hold is the defect that already happened
 * once here (`assignments.list_mine` and `staffing:read`).
 */
describe('who may record a worker\'s absence', () => {
  // Narrowed once: the tool declares a real token, asserted below, so this
  // is a type-level convenience and not an assumption being smuggled in.
  const gate = markWorkerAbsence.permission as NonNullable<
    typeof markWorkerAbsence.permission
  >;

  it.each([['ADMIN'], ['MANAGER'], ['REGIONAL_MANAGER']])(
    'admits %s, matching requireRole on the route',
    (role) => {
      expect(
        actorHasPermission(actorFor(role as keyof typeof ROLE_PERMISSIONS), gate)
      ).toBe(true);
    }
  );

  it.each([['WORKER'], ['CHECKER']])('denies %s, who may only mark their own', (role) => {
    expect(actorHasPermission(actorFor(role as keyof typeof ROLE_PERMISSIONS), gate)).toBe(false);
    // ...but their own path is untouched.
    expect(ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS]).toContain(
      'calendar:absence:write-own'
    );
  });

  it('declares a real token, not a borrowed or absent one', () => {
    // `null` is not available to a HIGH_RISK_WRITE, and `staffing:write`
    // would have been a token the route does not check.
    expect(markWorkerAbsence.permission).toBe('calendar:absence:write-team');
  });
});
