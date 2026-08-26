import { describe, it, expect, jest, beforeEach } from '@jest/globals';

import { api, setAccessToken } from '@/lib/api';

/**
 * Onboarding submission (api.employee).
 *
 * Verified against a running backend and a real database: submitting
 * onboarding for review from this app had never worked, for two independent
 * reasons.
 *
 *   POST /employee-management/employees/<user.id>/submit-for-review -> 404 Resource not found
 *   POST /employees/<user.id>/submit-for-review                     -> 404 Employment record not found
 *   POST /employees/EMP-FLOWTEST-1/submit-for-review                -> 409 "required documents are missing (…)"
 *
 * 1. The path. The router is mounted at `/employees` (routes/v1/index.ts), not
 *    `/employee-management/employees`, so the request never reached the module
 *    at all — it fell through to the generic 404 handler.
 * 2. The identifier. The service resolves the record by the human-facing
 *    `employee_id` ("EMP-W-001"), not the user id — and `/auth/me` does not
 *    return `employee_id`, so it must be resolved via `/employees/by-user/:id`
 *    first. This is exactly what the web client does.
 *
 * The 409 is the tell that the third form is correct: it means the record was
 * found, authorization passed, and the domain rule ran.
 */


const fetchMock = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
(globalThis as any).fetch = fetchMock;

function ok(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ status: 'success', data: body }),
    text: async () => JSON.stringify({ status: 'success', data: body }),
  };
}

describe('onboarding submission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setAccessToken('test-token');
  });

  it('resolves the employment record by user id', async () => {
    fetchMock.mockResolvedValue(ok({ employee_id: 'EMP-W-001' }));
    await api.employee.getByUserId('user-1');
    const [url] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toContain('/employees/by-user/user-1');
  });

  it('submits to /employees/:employee_id, without an /employee-management prefix', async () => {
    // Bug 1. The prefix meant the request never reached the module.
    fetchMock.mockResolvedValue(ok({}));
    await api.employee.submitForReview('EMP-W-001');
    const [url] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toContain('/employees/EMP-W-001/submit-for-review');
    expect(url).not.toContain('employee-management');
  });

  it('submits the employee_id, never the user id', async () => {
    // Bug 2. The service looks up EmploymentRecord by employee_id; a cuid user
    // id resolves to nothing and 404s.
    fetchMock.mockResolvedValue(ok({}));
    await api.employee.submitForReview('EMP-W-001');
    const [url] = fetchMock.mock.calls[0] as [string, any];
    expect(url).not.toMatch(/\/employees\/c[a-z0-9]{20,}\//);
  });

  it('POSTs, with the bearer token attached', async () => {
    fetchMock.mockResolvedValue(ok({}));
    await api.employee.submitForReview('EMP-W-001');
    const [, options] = fetchMock.mock.calls[0] as [string, any];
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer test-token');
  });
});
