import { api, setAccessToken } from '@/lib/api';

/**
 * GD-14 (SPEC-GEO-001 TREQ-GEO-001/003/004): mobile worker-app geo API
 * client. backend-geo (merged PR #253) has zero UI consumers until this
 * slice -- this suite pins the client-side request shape against that
 * already-frozen contract.
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

const mockCheckin = {
  id: 'c1',
  worker_id: 'w1',
  hotel_id: 'h1',
  distance_meters: 12.5,
  inside_radius: true,
  checked_at: '2026-07-28T00:00:00.000Z',
};

beforeEach(() => {
  mockFetch.mockReset();
  setAccessToken('tok-abc');
});

describe('api.geo.checkIn', () => {
  it('POSTs { hotel_id, latitude, longitude } to /geo/checkins, never a worker_id (self-scope is server-side)', async () => {
    mockFetch.mockResolvedValueOnce(res(201, { data: mockCheckin }));

    const result = await api.geo.checkIn({ hotel_id: 'h1', latitude: 52.52, longitude: 13.405 });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/geo/checkins');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ hotel_id: 'h1', latitude: 52.52, longitude: 13.405 });
    expect(body.worker_id).toBeUndefined();
    expect(result).toEqual(mockCheckin);
  });

  it('returns a response with no latitude/longitude fields (OD-GEO-005 -- distance/pass-fail only)', async () => {
    mockFetch.mockResolvedValueOnce(res(201, { data: mockCheckin }));

    const result = await api.geo.checkIn({ hotel_id: 'h1', latitude: 52.52, longitude: 13.405 });

    expect(result).not.toHaveProperty('latitude');
    expect(result).not.toHaveProperty('longitude');
    expect(result.distance_meters).toBe(12.5);
    expect(result.inside_radius).toBe(true);
  });
});
