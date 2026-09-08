import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Picking up an open shift.
 *
 * The properties that matter are the ones that decide whose day gets
 * committed: the broadcast is RESOLVED from what the caller is eligible for
 * rather than named by the model, ambiguity is refused rather than guessed,
 * and a lost race is reported as "someone took it" rather than as a failure.
 */

const mockList = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockEligibility = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockAccept = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
let phase2 = true;

jest.mock('../modules/job-requests/service.js', () => ({
  jobRequestService: {
    list: mockList,
    getBroadcastEligibility: mockEligibility,
    acceptBroadcast: mockAccept,
  },
}));
jest.mock('../config/feature-flags.js', () => ({
  isJobDispatchPhase2Enabled: () => phase2,
  isChatbotEnabled: () => true,
  isEmploymentRecordEnabled: () => false,
  isGD02MatrixEnabled: () => false,
  isConsentGateEnabled: () => false,
}));

import {
  listOpenShifts,
  acceptOpenShift,
} from '../modules/chatbot/tools/definitions/broadcast.tools.js';
import { actorHasPermission } from '../modules/chatbot/tools/executor.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const worker = (): ActorContext =>
  ({
    userId: 'w1',
    role: 'worker',
    permissions: ROLE_PERMISSIONS.WORKER ?? [],
    scope: null,
  }) as unknown as ActorContext;

const BROADCAST = {
  id: 'jr1',
  hotel_id: 'h1',
  hotel: { name: 'Premier Inn' },
  shift_date: '2026-09-15',
  position: 'Housekeeping',
  status: 'OPEN',
};

beforeEach(() => {
  jest.clearAllMocks();
  phase2 = true;
  mockList.mockResolvedValue({ data: [BROADCAST], total: 1 });
  mockEligibility.mockResolvedValue({
    job_request_id: 'jr1',
    slots: [{ skill: 'CLEANER', headcount: 2, confirmed_count: 0, eligible: true }],
  });
  mockAccept.mockResolvedValue({ status: 'ASSIGNED', assignment: { id: 'a1' } });
});

describe('arguments', () => {
  it('accepts a day and a hotel NAME, never an identifier', () => {
    expect(acceptOpenShift.args.safeParse({ day: '2026-09-15' }).success).toBe(true);
    expect(
      acceptOpenShift.args.safeParse({ day: '2026-09-15', hotel_name: 'Premier Inn' }).success
    ).toBe(true);

    for (const bad of [
      { day: '2026-09-15', job_request_id: 'jr1' },
      { day: '2026-09-15', hotel_id: 'h1' },
      { day: '2026-09-15', worker_id: 'w2' },
      { day: '2026-13-45' }, // semantically impossible date
    ]) {
      expect(acceptOpenShift.args.safeParse(bad).success).toBe(false);
    }
  });

  it('commits a day, so it is a confirmed high-risk write', () => {
    // The worker cannot un-accept it themselves, and the slot is taken from a
    // pool other people were also offered.
    expect(acceptOpenShift.tier).toBe('HIGH_RISK_WRITE');
    expect(acceptOpenShift.confirm).toBe(true);
    expect(listOpenShifts.tier).toBe('READ_ONLY');
  });
});

describe('listing open shifts', () => {
  it('asks the owning service with the CALLER as actor, so its scope applies', async () => {
    await listOpenShifts.invoke({} as never, worker());

    const [query, actor] = mockList.mock.calls[0] as [Record<string, unknown>, { userId: string }];
    expect(query.status).toBe('OPEN');
    // list() narrows a self-scoped caller to their roster hotels and their own
    // target_role; passing anything but the caller would defeat that.
    expect(actor.userId).toBe('w1');
  });

  it('says so plainly when there is nothing open', async () => {
    mockList.mockResolvedValue({ data: [], total: 0 });
    const out = await listOpenShifts.invoke({} as never, worker());
    expect(listOpenShifts.compress?.(out).summary).toMatch(/no open shifts/i);
  });

  it('leaks no job request id into what the model sees', async () => {
    const out = await listOpenShifts.invoke({} as never, worker());
    const json = JSON.stringify(listOpenShifts.compress?.(out));
    // The accept tool resolves by day, so an id here is a string the model
    // could repeat back and could not use.
    expect(json).not.toContain('jr1');
    expect(json).not.toContain('h1');
  });
});

describe('accepting', () => {
  it('resolves the broadcast from the day rather than being told which', async () => {
    await acceptOpenShift.invoke({ day: '2026-09-15' } as never, worker());

    const [id, skill] = mockAccept.mock.calls[0] as [string, string];
    expect(id).toBe('jr1'); // from the resolver, never from arguments
    expect(skill).toBe('CLEANER');
  });

  it('refuses rather than guessing when two shifts are open that day', async () => {
    mockList.mockResolvedValue({
      data: [BROADCAST, { ...BROADCAST, id: 'jr2', hotel: { name: 'Ibis' } }],
      total: 2,
    });

    const out = await acceptOpenShift.invoke({ day: '2026-09-15' } as never, worker());

    // Picking one would commit somebody's day to the wrong hotel.
    expect(mockAccept).not.toHaveBeenCalled();
    expect(acceptOpenShift.compress?.(out).summary).toMatch(/which hotel/i);
  });

  it('narrows by hotel name when one is given', async () => {
    mockList.mockResolvedValue({
      data: [BROADCAST, { ...BROADCAST, id: 'jr2', hotel: { name: 'Ibis' } }],
      total: 2,
    });

    await acceptOpenShift.invoke(
      { day: '2026-09-15', hotel_name: 'Ibis' } as never,
      worker()
    );
    expect((mockAccept.mock.calls[0] as [string])[0]).toBe('jr2');
  });

  it('refuses when more than one role is open on the shift', async () => {
    mockEligibility.mockResolvedValue({
      slots: [
        { skill: 'CLEANER', headcount: 1, confirmed_count: 0, eligible: true },
        { skill: 'WAITER', headcount: 1, confirmed_count: 0, eligible: true },
      ],
    });

    const out = await acceptOpenShift.invoke({ day: '2026-09-15' } as never, worker());

    // Accepting as the wrong skill puts somebody on a job they are not there
    // to do.
    expect(mockAccept).not.toHaveBeenCalled();
    expect(acceptOpenShift.compress?.(out).summary).toMatch(/more than one role/i);
  });

  it('ignores a slot the caller is not eligible for', async () => {
    mockEligibility.mockResolvedValue({
      slots: [
        { skill: 'CLEANER', headcount: 1, confirmed_count: 0, eligible: true },
        { skill: 'WAITER', headcount: 1, confirmed_count: 0, eligible: false },
      ],
    });

    await acceptOpenShift.invoke({ day: '2026-09-15' } as never, worker());
    // One eligible slot is not ambiguous.
    expect((mockAccept.mock.calls[0] as [string, string])[1]).toBe('CLEANER');
  });

  it('says the shift is filled rather than attempting a doomed write', async () => {
    mockEligibility.mockResolvedValue({
      slots: [{ skill: 'CLEANER', headcount: 1, confirmed_count: 1, eligible: true }],
    });

    const out = await acceptOpenShift.invoke({ day: '2026-09-15' } as never, worker());
    expect(mockAccept).not.toHaveBeenCalled();
    expect(acceptOpenShift.compress?.(out).summary).toMatch(/already been filled/i);
  });

  /**
   * A LOST RACE IS NOT AN ERROR. Somebody claimed the last slot between the
   * read and the write; the honest answer is that the shift is gone.
   */
  it('reports a lost race as the shift being taken, not as a failure', async () => {
    mockAccept.mockResolvedValue({ status: 'REQUIREMENT_FULFILLED' });

    const out = await acceptOpenShift.invoke({ day: '2026-09-15' } as never, worker());
    const summary = acceptOpenShift.compress?.(out).summary ?? '';

    expect(summary).toMatch(/someone else took that shift/i);
    expect(summary).not.toMatch(/you are booked/i);
  });

  it('confirms with the day and hotel a person recognises', async () => {
    const out = await acceptOpenShift.invoke({ day: '2026-09-15' } as never, worker());
    expect(acceptOpenShift.compress?.(out).summary).toMatch(/booked for 2026-09-15 at Premier Inn/i);
  });

  it('says nothing is open when there is nothing that day', async () => {
    mockList.mockResolvedValue({ data: [], total: 0 });
    const out = await acceptOpenShift.invoke({ day: '2026-09-15' } as never, worker());
    expect(mockAccept).not.toHaveBeenCalled();
    expect(acceptOpenShift.compress?.(out).summary).toMatch(/no open shifts/i);
  });
});

/**
 * Job dispatch has its OWN feature flag, separate from the chatbot's. Its
 * routes 404 when off, and surfacing that as a broken tool would describe the
 * platform as faulty rather than as not having the feature.
 */
describe('when job dispatch is disabled', () => {
  beforeEach(() => {
    phase2 = false;
  });

  it('refuses both tools without calling the service', async () => {
    const listed = await listOpenShifts.invoke({} as never, worker());
    const accepted = await acceptOpenShift.invoke({ day: '2026-09-15' } as never, worker());

    expect(mockList).not.toHaveBeenCalled();
    expect(mockAccept).not.toHaveBeenCalled();
    expect(listOpenShifts.compress?.(listed).summary).toMatch(/not available/i);
    expect(acceptOpenShift.compress?.(accepted).summary).toMatch(/not available/i);
  });
});

describe('who may accept', () => {
  it('gives every role the token, matching a route that admits every caller', () => {
    // It denies nobody; it exists so the capability is nameable, exactly like
    // calendar:absence:write-own. The service decides who may actually accept.
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      const held = ROLE_PERMISSIONS[role] ?? [];
      expect({ role, ok: held.includes('job_requests:accept-own') || held.includes('admin:*') })
        .toEqual({ role, ok: true });
    }
  });

  it('lets a real worker use both tools', () => {
    for (const tool of [listOpenShifts, acceptOpenShift]) {
      const gate = tool.permission;
      expect({ tool: tool.name, usable: gate === null || actorHasPermission(worker(), gate) })
        .toEqual({ tool: tool.name, usable: true });
    }
  });
});
