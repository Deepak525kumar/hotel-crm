import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockListPayroll = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
jest.mock('../modules/hr/service.js', () => ({ hrService: { listPayroll: mockListPayroll } }));

import { listMyPayslips } from '../modules/chatbot/tools/definitions/self-service.tools.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const actorFor = (role: string): ActorContext =>
  ({ userId: `user_${role}`, role: role.toLowerCase(), permissions: ROLE_PERMISSIONS[role] ?? [], scope: null }) as unknown as ActorContext;

const row = (over: Partial<any> = {}) => ({
  period_start: '2026-08-01',
  period_end: '2026-08-31',
  status: 'REQUESTED',
  fulfilled_at: null,
  created_at: '2026-09-01T10:00:00.000Z',
  ...over,
});

describe('hr.my_payslips', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListPayroll.mockResolvedValue({ data: [row()], total: 1 });
  });

  it('FORCES worker_id to the actor — without this a manager gets their team back', async () => {
    // listPayroll self-scopes worker/checker itself, but for manager/RM/admin
    // an absent worker_id returns everything in scope. A tool called "mine"
    // that did that would answer a question nobody asked.
    await listMyPayslips.invoke({ limit: 10 } as any, actorFor('MANAGER'));
    expect(mockListPayroll.mock.calls[0][0]).toMatchObject({ worker_id: 'user_MANAGER' });
  });

  it('forces it for every role, not just the ones the service would catch', async () => {
    for (const role of ['ADMIN', 'MANAGER', 'REGIONAL_MANAGER', 'CHECKER', 'WORKER']) {
      jest.clearAllMocks();
      mockListPayroll.mockResolvedValue({ data: [], total: 0 });
      await listMyPayslips.invoke({ limit: 5 } as any, actorFor(role));
      expect(mockListPayroll.mock.calls[0][0].worker_id).toBe(`user_${role}`);
    }
  });

  it('refuses any argument that names another person', () => {
    for (const bad of [{ worker_id: 'someone' }, { user_id: 'x' }, { workerId: 'y' }, { nonsense: 1 }]) {
      expect(listMyPayslips.args.safeParse(bad).success).toBe(false);
    }
  });

  it('only accepts statuses the underlying query actually supports', () => {
    // A status the query rejects would be a filter the model can set that
    // produces an error instead of an answer.
    expect(listMyPayslips.args.safeParse({ status: 'REQUESTED' }).success).toBe(true);
    expect(listMyPayslips.args.safeParse({ status: 'FULFILLED' }).success).toBe(true);
    expect(listMyPayslips.args.safeParse({ status: 'PENDING' }).success).toBe(false);
    expect(listMyPayslips.args.safeParse({ status: 'paid' }).success).toBe(false);
  });

  it('passes a supplied status through, and omits it when absent', async () => {
    await listMyPayslips.invoke({ status: 'FULFILLED', limit: 5 } as any, actorFor('WORKER'));
    expect(mockListPayroll.mock.calls[0][0].status).toBe('FULFILLED');
    jest.clearAllMocks();
    mockListPayroll.mockResolvedValue({ data: [], total: 0 });
    await listMyPayslips.invoke({ limit: 5 } as any, actorFor('WORKER'));
    expect(mockListPayroll.mock.calls[0][0]).not.toHaveProperty('status');
  });

  it('declares the same role-conditional gate the route enforces', () => {
    expect(listMyPayslips.tier).toBe('READ_ONLY');
    expect(listMyPayslips.scopeCheck).toBe('self');
    // Was `permission: null` plus a paragraph of rationale, because the
    // registry could not express an OR. requirePayslipReadAccess()
    // (hr/routes.ts:136-138) sends worker and checker to
    // `hr:payslip:read-own` and every other role to `hr:read`; `anyOf`
    // now says so directly, so the gate is declared instead of described.
    expect(listMyPayslips.permission).toEqual({ anyOf: ['hr:read', 'hr:payslip:read-own'] });
  });

  it('confirms the role-conditional OR is real for payslips too', () => {
    const holds = (r: string, t: string) => (ROLE_PERMISSIONS[r] ?? []).includes(t);
    expect(holds('WORKER', 'hr:payslip:read-own')).toBe(true);
    expect(holds('WORKER', 'hr:read')).toBe(false);
    expect(holds('MANAGER', 'hr:read')).toBe(true);
    expect(holds('MANAGER', 'hr:payslip:read-own')).toBe(false);
  });

  it('summarises how many are still awaiting fulfilment', () => {
    const out = listMyPayslips.compress({ data: [row(), row({ status: 'FULFILLED', fulfilled_at: '2026-09-02T09:00:00.000Z' })] });
    expect(out.summary).toMatch(/2 payslip requests, 1 still awaiting/);
    expect((out.data as any[])[1].fulfilled_on).toBe('2026-09-02');
  });

  it('handles an empty or malformed result without throwing', () => {
    expect(listMyPayslips.compress({ data: [] }).summary).toBe('No payslip requests found.');
    expect(listMyPayslips.compress(null).data).toEqual([]);
    expect(listMyPayslips.compress(undefined).summary).toBe('No payslip requests found.');
  });
});
