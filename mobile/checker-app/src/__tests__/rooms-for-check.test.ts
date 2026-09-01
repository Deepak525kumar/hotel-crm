import { api, setAccessToken } from '@/lib/api';
import { ROOM_STATE_TONE, roomStateTone } from '@/lib/room-state-tone';

/**
 * The wire shape of the room-first inspection flow (owner-approved,
 * 2026-09-01).
 *
 * `room_log_id` is the only thing linking an inspection to the room the worker
 * actually logged, and it travels as a multipart field among nine others -- the
 * exact kind of value that goes missing in a refactor without a single type
 * error. Both branches are asserted: sent from the room picker, ABSENT on the
 * "room not on the list" fallback, because an empty string there is not the
 * same request (the server would try to resolve it and refuse).
 */

const mockFetch = jest.fn();
globalThis.fetch = mockFetch as typeof globalThis.fetch;

function res(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    headers: { get: () => null },
  } as unknown as Response;
}

/**
 * The path + query of the single fetch the call under test made, with the base
 * URL dropped: it comes from EXPO_PUBLIC_API_URL and is not this test's
 * subject.
 */
function requestedPath(): string {
  const [url] = mockFetch.mock.calls[0] as [string];
  return url.slice(url.indexOf('/rooms'));
}

function sentForm(): FormData {
  const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
  return init.body as FormData;
}

beforeEach(() => {
  mockFetch.mockReset();
  setAccessToken('tok');
});

describe('api.rooms.forCheck', () => {
  const empty = { day: '2026-09-01', awaiting_check: [], reworked: [], already_checked: [] };

  it('sends no query when the caller asks for the default day', async () => {
    mockFetch.mockResolvedValueOnce(res({ data: empty }));
    await api.rooms.forCheck();
    expect(requestedPath()).toBe('/rooms/for-check');
  });

  it('carries day and hotel_id when narrowing the list', async () => {
    mockFetch.mockResolvedValueOnce(res({ data: empty }));
    await api.rooms.forCheck({ day: '2026-09-01', hotel_id: 'h-1' });
    expect(requestedPath()).toBe('/rooms/for-check?day=2026-09-01&hotel_id=h-1');
  });

  it('unwraps the three groups from the platform envelope', async () => {
    const room = {
      id: 'rl-1',
      assignment_id: 'a-1',
      hotel_id: 'h-1',
      hotel_name: 'Hotel One',
      worker_id: 'w-1',
      worker_name: 'Ada',
      day: '2026-09-01',
      room_number: '412',
      state: 'AWAITING_CHECK' as const,
      logged_at: '2026-09-01T08:00:00.000Z',
      verification_id: null,
      score: null,
      rework_assignment_id: null,
      editable: true,
    };
    mockFetch.mockResolvedValueOnce(res({ data: { ...empty, awaiting_check: [room] } }));

    const result = await api.rooms.forCheck();

    expect(result.awaiting_check).toEqual([room]);
    expect(result.reworked).toEqual([]);
    expect(result.already_checked).toEqual([]);
  });
});

describe('api.quality.recordInspection — room_log_id', () => {
  const base = {
    assignment_id: 'a-1',
    worker_id: 'w-1',
    room_number: '412',
    score: 90,
    outcome: 'complete' as const,
  };

  it('sends room_log_id when the checker came from the room picker', async () => {
    mockFetch.mockResolvedValueOnce(res({ data: { verification: { id: 'v-1' } } }));
    await api.quality.recordInspection({ ...base, room_log_id: 'rl-1' });
    expect(sentForm().get('room_log_id')).toBe('rl-1');
  });

  it('omits the field entirely on the manual fallback path', async () => {
    mockFetch.mockResolvedValueOnce(res({ data: { verification: { id: 'v-1' } } }));
    await api.quality.recordInspection(base);
    expect(sentForm().has('room_log_id')).toBe(false);
  });
});

describe('roomStateTone', () => {
  // The distinction the picker's three groups are built on: a reworked room
  // auto-passed on the worker's word, so it must NOT read as accepted.
  it('does not colour REWORK_SUBMITTED as a pass', () => {
    expect(ROOM_STATE_TONE.REWORK_SUBMITTED).not.toBe(ROOM_STATE_TONE.PASSED);
  });

  it('falls back to neutral for a state this build does not know', () => {
    expect(roomStateTone('SOMETHING_NEW')).toBe('neutral');
  });
});
