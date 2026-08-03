import { api, setAccessToken } from '@/lib/api';

/**
 * SPEC-CONSENT-001@0.2.0 FROZEN (ADR-015/ADR-037, GD-17): mobile worker-app
 * consent API client. The backend endpoints existed with full test coverage
 * and a web consumer (frontend/lib/api.ts's consentApi) but no mobile UI
 * ever consumed them until this slice — this suite pins the client-side
 * request shape against that already-frozen contract.
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

const mockRecord = {
  id: 'c1',
  worker_id: 'w1',
  consent_instance: 'daily-access-gate',
  notice_version: 'v1',
  decision: 'GRANTED' as const,
  decided_at: '2026-08-01T00:00:00.000Z',
};

beforeEach(() => {
  mockFetch.mockReset();
  setAccessToken('tok-abc');
});

describe('api.consent.getStatus', () => {
  it('GETs /consent/status with the consent_instance query param', async () => {
    mockFetch.mockResolvedValueOnce(res(200, { data: { status: 'absent' } }));

    const result = await api.consent.getStatus('daily-access-gate');

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/consent/status');
    expect(url).toContain('consent_instance=daily-access-gate');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(result).toEqual({ status: 'absent' });
  });
});

describe('api.consent.requestNotice', () => {
  it('POSTs { consent_instance } to /consent/request without a language when omitted', async () => {
    const notice = {
      consent_instance: 'daily-access-gate',
      notice_version: 'v1',
      notice_content: 'test notice',
      language: 'de',
      rtl: false,
    };
    mockFetch.mockResolvedValueOnce(res(200, { data: notice }));

    const result = await api.consent.requestNotice('daily-access-gate');

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/consent/request');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ consent_instance: 'daily-access-gate' });
    expect(result).toEqual(notice);
  });

  it('includes language when provided', async () => {
    mockFetch.mockResolvedValueOnce(res(200, { data: {} }));

    await api.consent.requestNotice('daily-access-gate', 'ar');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ consent_instance: 'daily-access-gate', language: 'ar' });
  });
});

describe('api.consent.recordDecision', () => {
  it('POSTs consent_instance/decision/notice_version to /consent/decisions, never a worker_id', async () => {
    mockFetch.mockResolvedValueOnce(res(201, { data: mockRecord }));

    const result = await api.consent.recordDecision({
      consent_instance: 'daily-access-gate',
      decision: 'GRANTED',
      notice_version: 'v1',
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/consent/decisions');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ consent_instance: 'daily-access-gate', decision: 'GRANTED', notice_version: 'v1' });
    expect(body.worker_id).toBeUndefined();
    expect(result).toEqual(mockRecord);
  });
});

describe('api.consent.withdraw', () => {
  it('POSTs { consent_instance } to /consent/withdraw', async () => {
    mockFetch.mockResolvedValueOnce(res(201, { data: { ...mockRecord, decision: 'WITHDRAWN' } }));

    const result = await api.consent.withdraw('daily-access-gate');

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/consent/withdraw');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ consent_instance: 'daily-access-gate' });
    expect(result).toEqual({ ...mockRecord, decision: 'WITHDRAWN' });
  });
});
