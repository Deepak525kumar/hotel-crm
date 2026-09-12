import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * `calendar.day_summary` and `calendar.set_day_summary`.
 *
 * REPORTED, not found by reading code. Two transcripts on 2026-09-12, one
 * from an admin and one from a manager, both refusing:
 *
 *     "Make day task rooms today we have 90 rooms to clean add that work
 *      list and 10 blibe"
 *
 * There was no tool for the daily shift summary at all, so the assistant
 * could staff a day it could not describe.
 *
 * MOST OF WHAT IS ASSERTED HERE IS THE MERGE. The route's body requires all
 * four counts, so a tool that passed through what it was told would write
 * zeros over the three it was not told about -- and a manager who says "90
 * rooms today" and then "4 people working" would silently lose the 90. That
 * is invisible on screen: the panel shows a complete, plausible row either
 * way.
 */

const mockGetRange = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockUpsert = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockResolveAccess = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../modules/calendar/shift-summary/service.js', () => ({
  ShiftSummaryService: class {
    getSummariesByDateRange = mockGetRange;
    upsertSummary = mockUpsert;
  },
}));
jest.mock('../middleware/permissions.js', () => ({ resolveHotelAccess: mockResolveAccess }));
jest.mock('../modules/chatbot/tools/worker-reference.js', () => ({
  resolveHotelReference: jest.fn(async () => ({
    status: 'RESOLVED',
    hotelId: 'h1',
    name: 'Hotel Adler',
  })) as any,
  refuseUnresolvedHotel: () => ({
    refused: { code: 'NOT_FOUND', message: 'Which hotel?', nextAction: 'ask_user' },
  }),
}));

import {
  daySummary,
  setDaySummary,
} from '../modules/chatbot/tools/definitions/shift-summary.tools.js';
import { resolveHotelReference } from '../modules/chatbot/tools/worker-reference.js';
import { actorHasPermission } from '../modules/chatbot/tools/executor.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const actorOf = (role: string, permissions: string[]): ActorContext =>
  ({
    userId: 'u1',
    role,
    permissions,
    scope: { hotel_group_id: 'g1' },
  }) as unknown as ActorContext;

const manager = () => actorOf('manager', ROLE_PERMISSIONS.MANAGER ?? []);
const admin = () => actorOf('admin', ROLE_PERMISSIONS.ADMIN ?? []);
const regional = () => actorOf('regional_manager', ROLE_PERMISSIONS.REGIONAL_MANAGER ?? []);

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  total_rooms: 90,
  stay_over_rooms: 10,
  checkout_rooms: 80,
  total_people_working: 4,
  notes: null,
  ...over,
});

const summaryOf = (raw: unknown) => setDaySummary.compress?.(raw).summary ?? '';
const readSummaryOf = (raw: unknown) => daySummary.compress?.(raw).summary ?? '';
/** The payload the service was actually asked to write. */
const written = () => mockUpsert.mock.calls[0]?.[2] as Record<string, number | string | null>;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetRange.mockResolvedValue([]);
  mockUpsert.mockImplementation(async (_h: string, _d: Date, payload: unknown) => payload);
  mockResolveAccess.mockResolvedValue({ allowed: true });
  (resolveHotelReference as jest.Mock).mockResolvedValue({
    status: 'RESOLVED',
    hotelId: 'h1',
    name: 'Hotel Adler',
  } as never);
});

describe('it records the numbers it was given', () => {
  it('writes the counts from a first-ever summary', async () => {
    await setDaySummary.invoke(
      { day: '2026-09-12', total_rooms: 90, stay_over_rooms: 10, people_working: 4 } as never,
      manager()
    );

    expect(written()).toMatchObject({
      total_rooms: 90,
      stay_over_rooms: 10,
      total_people_working: 4,
    });
  });

  /** The reported sentence, in the words it was reported in. */
  it('handles "90 rooms to clean and 10 blibe"', async () => {
    const out = await setDaySummary.invoke(
      { day: '2026-09-12', total_rooms: 90, stay_over_rooms: 10 } as never,
      manager()
    );

    expect(written()).toMatchObject({ total_rooms: 90, stay_over_rooms: 10 });
    expect(summaryOf(out)).toMatch(/90 rooms/);
    expect(summaryOf(out)).toMatch(/10 stay-over/);
  });

  it('records a note on its own', async () => {
    await setDaySummary.invoke(
      { day: '2026-09-12', notes: 'Third floor closed' } as never,
      manager()
    );
    expect(written().notes).toBe('Third floor closed');
  });
});

describe('the merge — what it must not erase', () => {
  /**
   * THE ONE THAT MATTERS. The route requires every count in the body, so a
   * pass-through tool writes zeros over everything it was not told. The
   * manager sees a complete row afterwards and no error, which is exactly why
   * this would not have been noticed.
   */
  it('keeps counts it was not told about', async () => {
    mockGetRange.mockResolvedValue([row()]);

    await setDaySummary.invoke({ day: '2026-09-12', people_working: 6 } as never, manager());

    expect(written()).toEqual({
      total_rooms: 90,
      stay_over_rooms: 10,
      checkout_rooms: 80,
      total_people_working: 6,
      notes: null,
    });
  });

  it('keeps an existing note when only a count changes', async () => {
    mockGetRange.mockResolvedValue([row({ notes: 'Lift out of service' })]);

    await setDaySummary.invoke({ day: '2026-09-12', total_rooms: 70 } as never, manager());
    expect(written().notes).toBe('Lift out of service');
  });

  /** `??`, not `||` -- a closed floor makes zero a real, intended count. */
  it('treats zero as a count, not as absent', async () => {
    mockGetRange.mockResolvedValue([row()]);

    await setDaySummary.invoke({ day: '2026-09-12', stay_over_rooms: 0 } as never, manager());
    expect(written().stay_over_rooms).toBe(0);
  });

  it('reads the whole row back, not only what changed', async () => {
    mockGetRange.mockResolvedValue([row()]);

    const out = await setDaySummary.invoke(
      { day: '2026-09-12', people_working: 6 } as never,
      manager()
    );
    // The manager needs to see the numbers they did NOT mention survived.
    expect(summaryOf(out)).toMatch(/90 rooms, 10 stay-over, 80 checkout, 6 working/);
  });

  it('refuses a call that would change nothing at all', () => {
    expect(setDaySummary.args.safeParse({ day: '2026-09-12' }).success).toBe(false);
    expect(setDaySummary.args.safeParse({ hotel_name: 'Adler' }).success).toBe(false);
  });
});

describe('what it will not infer', () => {
  /**
   * Housekeeping's own arithmetic is total = stay-over + checkout, but
   * neither the schema nor the panel enforces it and hotels count refusals
   * and out-of-service rooms differently. A derived number is
   * indistinguishable on screen from one a person typed.
   */
  it('does not derive checkout from total minus stay-over', async () => {
    await setDaySummary.invoke(
      { day: '2026-09-12', total_rooms: 90, stay_over_rooms: 10 } as never,
      manager()
    );
    expect(written().checkout_rooms).toBe(0);
  });

  it('says so when the parts do not add up, instead of fixing them', async () => {
    const out = await setDaySummary.invoke(
      {
        day: '2026-09-12',
        total_rooms: 90,
        stay_over_rooms: 10,
        checkout_rooms: 5,
      } as never,
      manager()
    );
    expect(summaryOf(out)).toMatch(/come to 15, not 90/);
  });

  it('stays quiet while a row is only half entered', async () => {
    const out = await setDaySummary.invoke(
      { day: '2026-09-12', total_rooms: 90 } as never,
      manager()
    );
    expect(summaryOf(out)).not.toMatch(/worth a check/);
  });
});

describe('reading it back', () => {
  it('says plainly when nothing has been recorded', async () => {
    mockGetRange.mockResolvedValue([]);
    const out = await daySummary.invoke({ day: '2026-09-12' } as never, manager());
    expect(readSummaryOf(out)).toMatch(/No daily summary has been recorded/);
  });

  it('reports the counts for a day that has one', async () => {
    mockGetRange.mockResolvedValue([row({ notes: 'Deep clean on 2' })]);
    const out = await daySummary.invoke({ day: '2026-09-12' } as never, manager());

    expect(readSummaryOf(out)).toMatch(/90 rooms, 10 stay-over, 80 checkout, 4 working/);
    expect(readSummaryOf(out)).toMatch(/Deep clean on 2/);
  });
});

describe('who can use it, and over which hotels', () => {
  /**
   * The tools call the service directly, so `requireRole` and
   * `checkHotelAccess` on the route never run. These assert the replacements
   * -- and that they name permissions the REAL role table grants, which is
   * the failure mode a suite of fabricated permissions cannot see.
   */
  it('is reachable by exactly the three roles the route allows', () => {
    for (const tool of [daySummary, setDaySummary]) {
      for (const actor of [manager(), admin(), regional()]) {
        expect(actorHasPermission(actor as never, tool.permission!)).toBe(true);
      }
      for (const role of ['WORKER', 'CHECKER'] as const) {
        const denied = { role: role.toLowerCase(), permissions: ROLE_PERMISSIONS[role] ?? [] };
        expect(actorHasPermission(denied as never, tool.permission!)).toBe(false);
      }
    }
  });

  it('re-applies the route\'s own hotel gate, and refuses without a retry', async () => {
    mockResolveAccess.mockResolvedValue({ allowed: false, reason: 'out_of_scope' });

    const out = await setDaySummary.invoke(
      { day: '2026-09-12', total_rooms: 10 } as never,
      regional()
    );

    expect(mockUpsert).not.toHaveBeenCalled();
    const compressed = setDaySummary.compress?.(out);
    // OUT_OF_SCOPE carries `stop`: rephrasing must not look like a way through.
    expect((compressed?.data as { refusal_code?: string })?.refusal_code).toBe('OUT_OF_SCOPE');
  });

  it('takes no hotel id, worker id or actor field from the model', () => {
    for (const bad of [{ hotel_id: 'h1' }, { user_id: 'u1' }, { role: 'admin' }]) {
      expect(
        setDaySummary.args.safeParse({ total_rooms: 10, ...bad }).success
      ).toBe(false);
    }
  });

  /**
   * An admin and an RM cover more than one hotel, so the hotel is asked for
   * rather than guessed -- the resolver lists their own hotels in the
   * question.
   */
  it('asks which hotel when the caller covers several', async () => {
    (resolveHotelReference as jest.Mock).mockResolvedValue({
      status: 'NEEDS_NAME',
      choices: ['Hotel Adler', 'Hotel Krone'],
    } as never);

    const out = await setDaySummary.invoke(
      { day: '2026-09-12', total_rooms: 90 } as never,
      admin()
    );
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(summaryOf(out)).toMatch(/Which hotel/);
  });
});

describe('how it is registered', () => {
  it('writes without a confirmation, because nothing it writes is destructive', () => {
    expect({ tier: setDaySummary.tier, confirm: setDaySummary.confirm }).toEqual({
      tier: 'LOW_RISK_WRITE',
      confirm: false,
    });
  });

  it('carries a real approval, not a placeholder', () => {
    for (const tool of [daySummary, setDaySummary]) {
      expect(tool.approvalRef).toMatch(/APPROVED 2026-09-12/);
      expect(tool.approvalRef).not.toMatch(/\bPENDING\b/i);
    }
  });

  /**
   * The description is what the model routes on, and "blibe" is the word the
   * reported prompt actually used. Losing the vocabulary would reopen the bug
   * without failing anything else.
   */
  it('carries the housekeeping vocabulary the report used', () => {
    expect(setDaySummary.description).toMatch(/blibe/);
    expect(setDaySummary.description).toMatch(/bleiben/);
    expect(setDaySummary.description).toMatch(/do NOT derive checkout/);
  });
});
