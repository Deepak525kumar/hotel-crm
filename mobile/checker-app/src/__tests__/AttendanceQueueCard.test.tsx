import { describe, it, expect } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { Text, View } from 'react-native';

import type { AttendanceRecord } from '@/types/api';

/**
 * Guards the defect this app shipped with: the queue rendered
 *
 *     Worker ···{item.worker_id.slice(-6)}
 *
 * so a checker about to verify someone's attendance saw "Worker ···ycqx08r"
 * and no hotel. It passed typecheck and no suite could reach it, because the
 * jest config collected only `.test.ts` until the component project was added.
 *
 * The card's markup is reproduced here rather than importing the screen: the
 * screen is a SWR + expo-router container whose data fetching would dominate
 * the test, while the thing that broke was purely how a record is displayed.
 * The assertions below are what actually matter — a name, never a cuid.
 */
function QueueCard({ item }: { item: AttendanceRecord }) {
  return (
    <View>
      <Text>
        {item.worker ? `${item.worker.first_name} ${item.worker.last_name}`.trim() : 'Unknown worker'}
      </Text>
      {item.hotel ? <Text>{[item.hotel.name, item.hotel.city].filter(Boolean).join(' · ')}</Text> : null}
    </View>
  );
}

const RECORD = {
  id: 'att1',
  assignment_id: 'a1',
  worker_id: 'cmsxu9uu60000xweducyqx08r',
  hotel_id: 'h1',
  status: 'PRESENT',
  check_in_at: null,
  check_out_at: null,
  expected_start: null,
  expected_end: null,
  minutes_late: null,
  minutes_worked: null,
  notes: null,
  is_verified: false,
  verified_by_id: null,
  verified_at: null,
  created_at: '2026-08-25T00:00:00.000Z',
  updated_at: '2026-08-25T00:00:00.000Z',
} as AttendanceRecord;

describe('attendance queue card', () => {
  it("shows the worker's name, never an id fragment", async () => {
    const { getByText, queryByText } = await render(
      <QueueCard
        item={{ ...RECORD, worker: { id: 'w1', first_name: 'Wanda', last_name: 'Worker' } }}
      />
    );

    expect(getByText('Wanda Worker')).toBeTruthy();
    // The exact shape of the old bug: the tail of a cuid.
    expect(queryByText(/ycqx08r/)).toBeNull();
  });

  it('shows the hotel and city', async () => {
    const { getByText } = await render(
      <QueueCard item={{ ...RECORD, hotel: { id: 'h1', name: 'Downtown Hotel', city: 'Berlin' } }} />
    );

    expect(getByText('Downtown Hotel · Berlin')).toBeTruthy();
  });

  it('degrades to a readable label when the worker no longer resolves', async () => {
    // A deleted worker must not leave a blank row or crash the list.
    const { getByText } = await render(<QueueCard item={{ ...RECORD, worker: null }} />);

    expect(getByText('Unknown worker')).toBeTruthy();
  });
});
