import { api, setAccessToken } from '@/lib/api';

/**
 * GD-14 (SPEC-GEO-001 wiring into backend-attendance): the worker-app now
 * sends coordinates with the check-in request itself, rather than through a
 * separate "Verify Location" call. Pins the client-side request shape.
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

const mockAttendance = {
  id: 'att1',
  assignment_id: 'a1',
  worker_id: 'w1',
  hotel_id: 'h1',
  status: 'PRESENT',
  check_in_at: '2026-07-28T08:00:00.000Z',
  check_out_at: null,
  expected_start: '2026-07-28T08:00:00.000Z',
  expected_end: '2026-07-28T16:00:00.000Z',
  minutes_late: 0,
  minutes_worked: null,
  notes: null,
  is_verified: false,
  verified_by_id: null,
  verified_at: null,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-28T08:00:00.000Z',
};

beforeEach(() => {
  mockFetch.mockReset();
  setAccessToken('tok-abc');
});

describe('api.attendance.checkIn', () => {
  it('POSTs { assignment_id } only when no location is supplied (backwards compatible)', async () => {
    mockFetch.mockResolvedValueOnce(res(201, { data: mockAttendance }));

    await api.attendance.checkIn('a1');

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/attendance');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ assignment_id: 'a1' });
  });

  it('includes latitude/longitude in the same request when location is supplied', async () => {
    mockFetch.mockResolvedValueOnce(res(201, { data: mockAttendance }));

    await api.attendance.checkIn('a1', { latitude: 52.52, longitude: 13.405 });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ assignment_id: 'a1', latitude: 52.52, longitude: 13.405 });
  });
});
