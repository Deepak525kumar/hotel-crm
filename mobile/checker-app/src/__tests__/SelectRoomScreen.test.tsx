import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, fireEvent } from '@testing-library/react-native';

import type { RoomLog } from '@/types/api';

/**
 * The room picker's three groups, its empty state, and the params it hands the
 * rating screen.
 *
 * The params are the part worth pinning: `room_log_id` is what links the
 * inspection to the room the worker logged, and it travels as one of four
 * route params. Drop it and the screen still works, the inspection still
 * records, and the link the whole feature exists for is silently gone -- with
 * no type error, because every param is a string.
 *
 * The empty case is asserted with the fallback link, not on its own: a checker
 * whose workers logged nothing is exactly the checker who needs the
 * "room not on the list" path, so hiding the link when the list is empty would
 * be the worst possible place to hide it.
 */

const mockSwr: { current: any } = { current: { data: undefined, isLoading: false } };
const mockPush = jest.fn();

jest.mock('swr', () => ({ __esModule: true, default: () => ({ mutate: jest.fn(), ...mockSwr.current }) }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
  Link: () => null,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const SelectRoomScreen = require('@/app/inspection/select-room').default;

function room(over: Partial<RoomLog> = {}): RoomLog {
  return {
    id: 'rl-1',
    assignment_id: 'a-1',
    hotel_id: 'h-1',
    hotel_name: 'Hotel One',
    worker_id: 'w-1',
    worker_name: 'Ada Lovelace',
    day: '2026-09-01',
    room_number: '412',
    state: 'AWAITING_CHECK',
    logged_at: '2026-09-01T08:00:00.000Z',
    verification_id: null,
    score: null,
    rework_assignment_id: null,
    editable: true,
    ...over,
  };
}

beforeEach(() => {
  mockPush.mockReset();
  mockSwr.current = { data: undefined, isLoading: false };
});

describe('room picker', () => {
  it('labels each group it has rows for, and omits the ones it does not', async () => {
    mockSwr.current = {
      isLoading: false,
      data: {
        day: '2026-09-01',
        awaiting_check: [room()],
        reworked: [],
        already_checked: [room({ id: 'rl-3', room_number: '210', state: 'PASSED', score: 88 })],
      },
    };

    const { getByText, queryByText } = await render(<SelectRoomScreen />);

    // SectionHeader upper-cases its title.
    expect(getByText('AWAITING CHECK')).toBeTruthy();
    expect(getByText('ALREADY CHECKED')).toBeTruthy();
    expect(queryByText(/REVIEW PHOTOS/)).toBeNull();
  });

  it('shows the score on a checked row and nothing where there is none', async () => {
    mockSwr.current = {
      isLoading: false,
      data: {
        day: '2026-09-01',
        awaiting_check: [room()],
        reworked: [],
        already_checked: [room({ id: 'rl-3', room_number: '210', state: 'PASSED', score: 88 })],
      },
    };

    const { getAllByText, queryByText } = await render(<SelectRoomScreen />);

    expect(getAllByText(/88/).length).toBeGreaterThan(0);
    expect(queryByText('Score {{score}}')).toBeNull();
  });

  it('carries assignment, worker, room log and room number to the rating screen', async () => {
    mockSwr.current = {
      isLoading: false,
      data: { day: '2026-09-01', awaiting_check: [room()], reworked: [], already_checked: [] },
    };

    const { getByText } = await render(<SelectRoomScreen />);
    fireEvent.press(getByText('Room 412'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/rating/[id]',
      params: {
        id: 'a-1',
        worker_id: 'w-1',
        room_log_id: 'rl-1',
        room_number: '412',
      },
    });
  });

  it('keeps the manual fallback reachable when nothing was logged', async () => {
    mockSwr.current = {
      isLoading: false,
      data: { day: '2026-09-01', awaiting_check: [], reworked: [], already_checked: [] },
    };

    const { getByText } = await render(<SelectRoomScreen />);

    expect(getByText('No rooms to check')).toBeTruthy();

    fireEvent.press(getByText('Room not on the list?'));
    expect(mockPush).toHaveBeenCalledWith('/inspection/select-worker');
  });

  it('says the load failed rather than claiming there is nothing to check', async () => {
    mockSwr.current = { isLoading: false, data: undefined, error: new Error('offline') };

    const { getByText, queryByText } = await render(<SelectRoomScreen />);

    expect(queryByText('No rooms to check')).toBeNull();
    // Still reachable: an offline picker must not trap the checker.
    expect(getByText('Room not on the list?')).toBeTruthy();
  });
});
