import { describe, it, expect } from '@jest/globals';
import { RaiseBroadcastSchema, AcceptBroadcastSchema } from '../modules/job-requests/types.js';

/**
 * Schema-level regression for the "no specific skill required" feature
 * (2026-08-26, reported live: "There should also be an option for none" /
 * "the request should go to all the workers that are in scope"). Pins the
 * exact wire contract independent of any service/DB mocking: `skill: null`
 * must be ACCEPTED (an explicit "no skill" choice), while an entirely
 * missing `skill` key must still be REJECTED — the caller has to say "no
 * skill" on purpose, not merely leave the field out, since the request
 * schema still requires the KEY to be present.
 */

const baseBroadcastFields = {
  hotel_id: 'h1',
  shift_date: '2026-08-01',
  shift_start_time: '08:00',
  shift_end_time: '16:00',
};

describe('RaiseBroadcastSchema — null skill lines', () => {
  it('accepts a skill line with skill: null', () => {
    const result = RaiseBroadcastSchema.safeParse({
      ...baseBroadcastFields,
      skills: [{ skill: null, headcount: 3 }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skills).toEqual([{ skill: null, headcount: 3 }]);
    }
  });

  it('accepts a broadcast mixing a real skill line and a null skill line', () => {
    const result = RaiseBroadcastSchema.safeParse({
      ...baseBroadcastFields,
      skills: [
        { skill: 'CLEANER', headcount: 2 },
        { skill: null, headcount: 1 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a skill line missing the skill key entirely', () => {
    const result = RaiseBroadcastSchema.safeParse({
      ...baseBroadcastFields,
      skills: [{ headcount: 3 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown skill string (not one of the 4 SkillTag values, and not null)', () => {
    const result = RaiseBroadcastSchema.safeParse({
      ...baseBroadcastFields,
      skills: [{ skill: 'NOT_A_REAL_SKILL', headcount: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it('still rejects an empty skills array — at least one line (skilled or not) is required', () => {
    const result = RaiseBroadcastSchema.safeParse({
      ...baseBroadcastFields,
      skills: [],
    });
    expect(result.success).toBe(false);
  });

  it('still accepts a fully-skilled broadcast unchanged (no regression)', () => {
    const result = RaiseBroadcastSchema.safeParse({
      ...baseBroadcastFields,
      skills: [{ skill: 'WAITER', headcount: 1 }],
    });
    expect(result.success).toBe(true);
  });
});

describe('AcceptBroadcastSchema — null skill', () => {
  it('accepts skill: null (claims the "no specific skill required" slot)', () => {
    const result = AcceptBroadcastSchema.safeParse({ skill: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skill).toBeNull();
    }
  });

  it('rejects a missing skill key entirely', () => {
    const result = AcceptBroadcastSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('still accepts a real skill value unchanged (no regression)', () => {
    const result = AcceptBroadcastSchema.safeParse({ skill: 'CLEANER' });
    expect(result.success).toBe(true);
  });
});
