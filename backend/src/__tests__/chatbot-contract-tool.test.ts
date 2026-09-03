import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockGetContractStatus = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
jest.mock('../modules/hr/service.js', () => ({
  hrService: { getContractStatus: mockGetContractStatus },
}));

import { getMyContract } from '../modules/chatbot/tools/definitions/self-service.tools.js';
import { ROLE_PERMISSIONS } from '../config/constants.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const actorFor = (role: string): ActorContext =>
  ({
    userId: `user_${role}`,
    role: role.toLowerCase(),
    permissions: ROLE_PERMISSIONS[role] ?? [],
    scope: null,
  }) as unknown as ActorContext;

const contract = (over: Partial<any> = {}) => ({
  id: 'c1',
  worker_id: 'user_WORKER',
  template_id: 'tpl_1',
  position: 'Room Attendant',
  start_date: '2026-01-15',
  end_date: '2026-12-31',
  status: 'ACTIVE',
  employment_type: 'FULL_TIME',
  scanned_document_id: 'doc_9',
  signed_scan_uploaded: true,
  ...over,
});

describe('hr.my_contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetContractStatus.mockResolvedValue(contract());
  });

  it('passes the actor id as BOTH subject and caller — that is what makes it "mine"', async () => {
    // getContractStatus's own guard (worker/checker may only view their own)
    // is then satisfied by construction, not by trusting this call site.
    await getMyContract.invoke({} as any, actorFor('WORKER'));
    expect(mockGetContractStatus).toHaveBeenCalledWith('user_WORKER', 'user_WORKER', 'worker');
  });

  it('accepts NO arguments at all, so there is nothing to point at another person', () => {
    expect(getMyContract.args.safeParse({}).success).toBe(true);
    for (const bad of [{ worker_id: 'x' }, { user_id: 'x' }, { workerId: 'x' }, { anything: 1 }]) {
      expect(getMyContract.args.safeParse(bad).success).toBe(false);
    }
  });

  it('works for EVERY role — the role-conditional gate locks nobody out', async () => {
    // The route gates worker/checker on hr:contract:read-own and
    // admin/manager/RM on hr:read. Declaring either token would have denied
    // the other half; this asserts against the real ROLE_PERMISSIONS that
    // all five roles genuinely reach their own contract.
    for (const role of ['ADMIN', 'MANAGER', 'REGIONAL_MANAGER', 'CHECKER', 'WORKER']) {
      await expect(getMyContract.invoke({} as any, actorFor(role))).resolves.toBeDefined();
    }
  });

  it('confirms the OR the registry cannot express is real, not imagined', () => {
    // If this ever becomes expressible with one token, the rationale on the
    // tool should be revisited rather than left as stale justification.
    const holds = (r: string, t: string) => (ROLE_PERMISSIONS[r] ?? []).includes(t);
    expect(holds('WORKER', 'hr:contract:read-own')).toBe(true);
    expect(holds('WORKER', 'hr:read')).toBe(false);
    expect(holds('MANAGER', 'hr:read')).toBe(true);
    expect(holds('MANAGER', 'hr:contract:read-own')).toBe(false);
  });

  it('stays inside the envelope a null permission requires', () => {
    expect(getMyContract.tier).toBe('READ_ONLY');
    expect(getMyContract.scopeCheck).toBe('self');
    expect(getMyContract.permission).toBeNull();
    expect(getMyContract.permissionRationale).toBeTruthy();
  });

  it('drops every internal identifier from the result', () => {
    const out = getMyContract.compress(contract());
    const json = JSON.stringify(out);
    for (const leak of ['c1', 'tpl_1', 'doc_9', 'worker_id', 'template_id', 'scanned_document_id']) {
      expect(json).not.toContain(leak);
    }
  });

  it('reports a permanent contract as such rather than as a missing date', () => {
    const out = getMyContract.compress(contract({ end_date: null }));
    expect(out.summary).toMatch(/no end date \(permanent\)/);
  });

  it('says plainly when there is no contract yet', () => {
    // A real, common state: an applicant partway through onboarding.
    const out = getMyContract.compress(null);
    expect(out.summary).toBe('No contract on file yet.');
    expect(out.data).toBeNull();
  });

  it('surfaces whether a signed copy is on file, from the combined flag', () => {
    // Must come from signed_scan_uploaded, never scanned_document_id alone —
    // the applicant's own upload path writes no Contract column.
    expect((getMyContract.compress(contract({ signed_scan_uploaded: false })).data as any).signed_copy_received).toBe(false);
    expect((getMyContract.compress(contract({ signed_scan_uploaded: true })).data as any).signed_copy_received).toBe(true);
  });
});
