import { resolveMySlots } from '@/lib/broadcast-eligibility';
import type { Broadcast, BroadcastEligibility } from '@/types/api';

const makeBroadcast = (overrides: Partial<Broadcast> = {}): Broadcast => ({
  id: 'jr1',
  hotel_id: 'h1',
  position: '2x CLEANER',
  workers_needed: 2,
  workers_confirmed: 0,
  shift_date: '2026-08-10',
  shift_start_time: '08:00',
  shift_end_time: '16:00',
  status: 'OPEN',
  created_at: '2026-08-01T00:00:00Z',
  skill_slots: [
    { id: 'slot1', skill: 'CLEANER', headcount: 2, confirmed_count: 0 },
    { id: 'slot2', skill: 'WAITER', headcount: 1, confirmed_count: 1 },
  ],
  ...overrides,
});

// eligible reflects the calling worker's own inclusion, computed
// server-side — there is no id list to check the caller against anymore.
const makeEligibility = (overrides: Partial<BroadcastEligibility> = {}): BroadcastEligibility => ({
  job_request_id: 'jr1',
  hotel_id: 'h1',
  shift_date: '2026-08-10',
  slots: [
    { skill: 'CLEANER', headcount: 2, confirmed_count: 0, eligible_count: 2, eligible: true },
    { skill: 'WAITER', headcount: 1, confirmed_count: 1, eligible_count: 1, eligible: true },
  ],
  ...overrides,
});

describe('resolveMySlots', () => {
  it('returns slots the current user is eligible for and not yet filled', () => {
    const eligibility = makeEligibility({
      slots: [
        { skill: 'CLEANER', headcount: 2, confirmed_count: 0, eligible_count: 2, eligible: true },
        { skill: 'WAITER', headcount: 1, confirmed_count: 1, eligible_count: 1, eligible: false },
      ],
    });
    const result = resolveMySlots(makeBroadcast(), eligibility);
    expect(result).toEqual([{ id: 'slot1', skill: 'CLEANER', headcount: 2, confirmed_count: 0 }]);
  });

  it('excludes a slot the user is eligible for but is already filled', () => {
    const eligibility = makeEligibility({
      slots: [{ skill: 'WAITER', headcount: 1, confirmed_count: 1, eligible_count: 1, eligible: true }],
    });
    const result = resolveMySlots(makeBroadcast(), eligibility);
    expect(result).toEqual([]);
  });

  it('excludes a slot the user is not eligible for even if open', () => {
    const eligibility = makeEligibility({
      slots: [{ skill: 'CLEANER', headcount: 2, confirmed_count: 0, eligible_count: 1, eligible: false }],
    });
    const result = resolveMySlots(makeBroadcast(), eligibility);
    expect(result).toEqual([]);
  });

  it('returns empty when eligibility has not loaded yet', () => {
    expect(resolveMySlots(makeBroadcast(), null)).toEqual([]);
  });

  it('returns empty when eligible is undefined (e.g. an admin/manager response, which never carries it)', () => {
    const eligibility = makeEligibility({
      slots: [{ skill: 'CLEANER', headcount: 2, confirmed_count: 0, eligible_count: 2 }],
    });
    expect(resolveMySlots(makeBroadcast(), eligibility)).toEqual([]);
  });

  it('returns multiple slots when eligible for more than one skill', () => {
    const broadcast = makeBroadcast({
      skill_slots: [
        { id: 'slot1', skill: 'CLEANER', headcount: 2, confirmed_count: 0 },
        { id: 'slot2', skill: 'WAITER', headcount: 1, confirmed_count: 0 },
      ],
    });
    const eligibility = makeEligibility({
      slots: [
        { skill: 'CLEANER', headcount: 2, confirmed_count: 0, eligible_count: 1, eligible: true },
        { skill: 'WAITER', headcount: 1, confirmed_count: 0, eligible_count: 1, eligible: true },
      ],
    });
    const result = resolveMySlots(broadcast, eligibility);
    expect(result.map((s) => s.skill).sort()).toEqual(['CLEANER', 'WAITER']);
  });
});
