import { api, setAccessToken } from '@/lib/api';

/**
 * Checker-app calendar parity (2026-08-14): the backend's /calendar routes
 * carry no role gate, self-scope is the authorization, so a Checker was
 * always permitted to declare/withdraw an absence -- only this client was
 * missing. Pins the client-side request shape.
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

beforeEach(() => {
  mockFetch.mockReset();
  setAccessToken('tok-abc');
});

describe('api.calendar', () => {
  it('GETs /calendar/my-absences', async () => {
    mockFetch.mockResolvedValueOnce(res(200, { data: [] }));
    await api.calendar.myAbsences();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/calendar/my-absences');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('POSTs a mark to /calendar/my-absences', async () => {
    mockFetch.mockResolvedValueOnce(res(200, { data: {} }));
    await api.calendar.markAbsence({ day: '2026-08-20', kind: 'SICK' });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/calendar/my-absences');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ day: '2026-08-20', kind: 'SICK' });
  });

  it('DELETEs /calendar/absences/:id', async () => {
    mockFetch.mockResolvedValueOnce(res(204, {}));
    await api.calendar.deleteAbsence('a1');
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/calendar/absences/a1');
    expect(init?.method).toBe('DELETE');
  });
});
