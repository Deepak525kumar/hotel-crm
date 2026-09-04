import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockAssignRework = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
jest.mock('../modules/quality/service.js', () => ({
  qualityService: { assignRework: mockAssignRework, listOwnChecks: jest.fn() },
}));

import { assignReworkTool } from '../modules/chatbot/tools/definitions/self-service.tools.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const actorFor = (role: string): ActorContext =>
  ({ userId: `u_${role}`, role: role.toLowerCase(), permissions: ROLE_PERMISSIONS[role] ?? [], scope: null }) as unknown as ActorContext;

describe('quality.assign_rework — the first HIGH_RISK_WRITE', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAssignRework.mockResolvedValue({ id: 'rw1', room_number: '204' });
  });

  it('is HIGH_RISK_WRITE and cannot skip confirmation', () => {
    // ADR-053 item 5: mandatory regardless of tool preference, and forced at
    // registration. Rework creates a linked assignment for another person and
    // notifies them, so it is not something to do by accident.
    expect(assignReworkTool.tier).toBe('HIGH_RISK_WRITE');
    expect(assignReworkTool.confirm).toBe(true);
  });

  it('declares a REAL permission token, not the null escape hatch', () => {
    // POST /quality/rework enforces exactly this token, so it is declared
    // honestly rather than modelled as null.
    expect(assignReworkTool.permission).toBe('quality:write');
    expect(assignReworkTool.scopeCheck).toBe('hotel');
  });

  it('is reachable by the role that actually does this work', () => {
    // Asserted against the REAL ROLE_PERMISSIONS. A rework tool a checker
    // cannot invoke would be the same defect that once shipped here.
    expect(ROLE_PERMISSIONS['CHECKER']).toContain('quality:write');
    expect(ROLE_PERMISSIONS['WORKER']).not.toContain('quality:write');
  });

  it('passes the caller through as the actor, so scope is the caller’s own', async () => {
    // assignRework applies isScopedManagerRole/isHotelInScope itself, so a
    // checker can only send back work at a hotel they already cover.
    await assignReworkTool.invoke({ verification_id: 'v1', notes: 'missed the bathroom' } as any, actorFor('CHECKER'));
    expect(mockAssignRework).toHaveBeenCalledTimes(1);
    const [input, actor] = mockAssignRework.mock.calls[0];
    expect(input).toEqual({ verification_id: 'v1', notes: 'missed the bathroom' });
    expect(actor.userId).toBe('u_CHECKER');
  });

  it('refuses any argument naming a person or a hotel', () => {
    // Those are authorization inputs; the model must never supply one.
    for (const bad of [
      { verification_id: 'v1', notes: 'x', worker_id: 'w1' },
      { verification_id: 'v1', notes: 'x', hotel_id: 'h1' },
      { verification_id: 'v1', notes: 'x', actorId: 'a' },
    ]) {
      expect(assignReworkTool.args.safeParse(bad).success).toBe(false);
    }
  });

  it('requires a non-empty note, because the worker is told why', () => {
    expect(assignReworkTool.args.safeParse({ verification_id: 'v1', notes: '' }).success).toBe(false);
    expect(assignReworkTool.args.safeParse({ verification_id: 'v1', notes: '   ' }).success).toBe(false);
    expect(assignReworkTool.args.safeParse({ verification_id: 'v1' }).success).toBe(false);
  });

  it('bounds the note and the id rather than passing arbitrary length through', () => {
    expect(assignReworkTool.args.safeParse({ verification_id: 'v1', notes: 'x'.repeat(1001) }).success).toBe(false);
    expect(assignReworkTool.args.safeParse({ verification_id: 'v'.repeat(65), notes: 'x' }).success).toBe(false);
  });

  it('summarises the room without leaking identifiers', () => {
    const out = assignReworkTool.compress({ id: 'rw1', room_number: '204' });
    expect(out.summary).toMatch(/Room 204 sent back for rework/);
    expect(JSON.stringify(out)).not.toContain('rw1');
  });

  it('still summarises when the service returns an unexpected shape', () => {
    expect(assignReworkTool.compress(null).summary).toBe('Rework assigned.');
    expect(assignReworkTool.compress({}).summary).toBe('Rework assigned.');
  });
});
