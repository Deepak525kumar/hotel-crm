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

const makeEligibility = (overrides: Partial<BroadcastEligibility> = {}): BroadcastEligibility => ({
  job_request_id: 'jr1',
  hotel_id: 'h1',
  shift_date: '2026-08-10',
  slots: [
    { skill: 'CLEANER', headcount: 2, confirmed_count: 0, eligible_worker_ids: ['w1', 'w2'] },
    { skill: 'WAITER', headcount: 1, confirmed_count: 1, eligible_worker_ids: ['w3'] },
  ],
  ...overrides,
});

describe('resolveMySlots', () => {
  it('returns slots the current user is eligible for and not yet filled', () => {
    const result = resolveMySlots(makeBroadcast(), makeEligibility(), 'w1');
    expect(result).toEqual([{ id: 'slot1', skill: 'CLEANER', headcount: 2, confirmed_count: 0 }]);
  });

  it('excludes a slot the user is eligible for but is already filled', () => {
    const result = resolveMySlots(makeBroadcast(), makeEligibility(), 'w3');
    expect(result).toEqual([]);
  });

  it('excludes a slot the user is not eligible for even if open', () => {
    const eligibility = makeEligibility({
      slots: [{ skill: 'CLEANER', headcount: 2, confirmed_count: 0, eligible_worker_ids: ['someone-else'] }],
    });
    const result = resolveMySlots(makeBroadcast(), eligibility, 'w1');
    expect(result).toEqual([]);
  });

  it('returns empty when eligibility has not loaded yet', () => {
    expect(resolveMySlots(makeBroadcast(), null, 'w1')).toEqual([]);
  });

  it('returns empty when there is no current user id', () => {
    expect(resolveMySlots(makeBroadcast(), makeEligibility(), undefined)).toEqual([]);
    expect(resolveMySlots(makeBroadcast(), makeEligibility(), null)).toEqual([]);
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
        { skill: 'CLEANER', headcount: 2, confirmed_count: 0, eligible_worker_ids: ['w1'] },
        { skill: 'WAITER', headcount: 1, confirmed_count: 0, eligible_worker_ids: ['w1'] },
      ],
    });
    const result = resolveMySlots(broadcast, eligibility, 'w1');
    expect(result.map((s) => s.skill).sort()).toEqual(['CLEANER', 'WAITER']);
  });
});
