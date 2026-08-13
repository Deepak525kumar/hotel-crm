import { api, setAccessToken } from '@/lib/api';

/**
 * GD-18 narrow slice (SPEC-CALENDAR-001 REQ-CAL-T02/T03/T04/T08): mobile
 * worker-app calendar API client. The backend endpoints (/calendar/my-absences
 * GET/POST) were merged in PR #243 with full backend test coverage but no
 * mobile UI ever consumed them until this slice — this suite pins the
 * client-side request shape against that already-frozen contract.
 */

const mockFetch = jest.fn();
globalThis.fetch = mockFetch as typeof globalThis.fetch;

function res(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: { get: () => null },
  } as unknown as Response;
}

const mockAbsence = {
  id: 'a1',
  worker_id: 'w1',
  day: '2026-07-28',
  kind: 'SICK' as const,
  created_at: '2026-07-28T00:00:00.000Z',
  updated_at: '2026-07-28T00:00:00.000Z',
};

beforeEach(() => {
  mockFetch.mockReset();
  setAccessToken('tok-abc');
});

describe('api.calendar.myAbsences', () => {
  it('GETs /calendar/my-absences and returns the array from body.data', async () => {
    mockFetch.mockResolvedValueOnce(res(200, { data: [mockAbsence] }));

    const result = await api.calendar.myAbsences();

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/calendar/my-absences');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(result).toEqual([mockAbsence]);
  });
});

describe('api.calendar.markAbsence', () => {
  it('POSTs { day, kind } to /calendar/my-absences, never a worker_id (self-scope is server-side)', async () => {
    mockFetch.mockResolvedValueOnce(res(201, { data: mockAbsence }));

    const result = await api.calendar.markAbsence({ day: '2026-07-28', kind: 'SICK' });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/calendar/my-absences');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ day: '2026-07-28', kind: 'SICK' });
    expect(body.worker_id).toBeUndefined();
    expect(result).toEqual(mockAbsence);
  });
});

/**
 * Withdraw parity (2026-08-13): a worker could mark themselves sick from the
 * phone but had no way to undo it here -- the action existed only on the web
 * app, which is not where workers actually are. Pins the request shape against
 * the backend's existing DELETE /calendar/absences/:id route.
 */
describe('api.calendar.deleteAbsence', () => {
  it('DELETEs /calendar/absences/:id', async () => {
    mockFetch.mockResolvedValueOnce(res(204, {}));

    await api.calendar.deleteAbsence('a1');

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/calendar/absences/a1');
    expect(init?.method).toBe('DELETE');
  });

  it('sends no body -- the absence is identified by the path alone', async () => {
    mockFetch.mockResolvedValueOnce(res(204, {}));

    await api.calendar.deleteAbsence('a1');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init?.body).toBeUndefined();
  });

  // The backend self-scopes deletion and refuses a past day; the client must
  // surface that rejection rather than optimistically assuming success.
  it('rejects when the backend refuses the withdrawal', async () => {
    mockFetch.mockResolvedValueOnce(
      res(409, { error: { code: 'CONFLICT', message: 'Cannot delete an absence in the past' } })
    );

    await expect(api.calendar.deleteAbsence('a1')).rejects.toMatchObject({
      message: 'Cannot delete an absence in the past',
    });
  });
});
