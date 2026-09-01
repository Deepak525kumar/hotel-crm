import { describe, it, expect, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';

/**
 * The room number must be fixed text when the checker came from the room
 * picker, and an editable input when they did not.
 *
 * Rendered rather than asserted against the source, for the same reason as
 * LoginInputs: this is one input among three on the screen, and a grep cannot
 * tell which branch a `TextInput` landed in. It is also the whole point of the
 * room-first flow (owner-approved, 2026-09-01) -- if the field stays typable
 * when a room log was chosen, the checker can retype the room into something
 * the server will refuse, and the old typo defect is back.
 *
 * The fallback branch is asserted too, deliberately: the worker-first path
 * exists because a worker can forget to log a room, and a "fix" that made the
 * field permanently read-only would make a skipped room uninspectable.
 */

const mockParams: { current: Record<string, string> } = { current: {} };

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams.current,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  Link: () => null,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RatingScreen = require('@/app/rating/[id]').default;

/** The room field is identified by its prop, not its placeholder: the
 *  placeholders come from i18n and would tie this test to translation keys. */
async function roomInput() {
  const { root } = await render(<RatingScreen />);
  const inputs = root!.queryAll((node: any) => node.type === 'TextInput');
  return inputs.find((i: any) => i.props.autoCapitalize === 'characters');
}

describe('rating screen room field', () => {
  it('is not typable when a room log was chosen', async () => {
    mockParams.current = { id: 'a-1', worker_id: 'w-1', room_log_id: 'rl-1', room_number: '412' };
    expect(await roomInput()).toBeUndefined();
  });

  it('shows the chosen room number as text', async () => {
    mockParams.current = { id: 'a-1', worker_id: 'w-1', room_log_id: 'rl-1', room_number: '412' };
    const { getByText } = await render(<RatingScreen />);
    expect(getByText('412')).toBeTruthy();
  });

  it('stays typable on the worker-first fallback path', async () => {
    mockParams.current = { id: 'a-1', worker_id: 'w-1' };
    const input = await roomInput();
    expect(input).toBeTruthy();
    expect((input as any).props.value).toBe('');
  });
});
