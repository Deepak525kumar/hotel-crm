import { describe, it, expect, beforeEach } from '@jest/globals';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// RNTL 14 pairs with React 19's async test renderer: `render` returns a
// Promise, so every test awaits it.

import { ThemePicker } from '@/components/ThemePicker';
import { useThemeStore } from '@/stores/theme-store';

/**
 * First component test in this app.
 *
 * It exists as much to prove the harness as to cover the picker: until now the
 * jest config collected only `.test.ts`, so no `.tsx` file was reachable by any
 * suite, and five of the eight defects found in the 2026-08-25 mobile flow
 * verification shipped through that hole.
 *
 * The picker is a good first subject because its whole job is state a user can
 * see: which mode is selected, and that tapping one selects it.
 */
describe('ThemePicker', () => {
  beforeEach(() => {
    useThemeStore.setState({ mode: 'system', hydrated: true });
  });

  it('offers all three modes, including System', async () => {
    // A two-position switch cannot express "follow the device", and losing that
    // would change the default behaviour for everyone who never opens settings.
    const { getByText } = await render(<ThemePicker />);

    expect(getByText('Match device')).toBeTruthy();
    expect(getByText('Light')).toBeTruthy();
    expect(getByText('Dark')).toBeTruthy();
  });

  it('marks the active mode as selected for assistive tech', async () => {
    useThemeStore.setState({ mode: 'dark', hydrated: true });
    const { getAllByRole } = await render(<ThemePicker />);

    const rows = getAllByRole('radio');
    const selected = rows.filter((r) => r.props.accessibilityState?.selected);

    expect(selected).toHaveLength(1);
    // Regex, not a string: toHaveTextContent matches exactly, and the selected
    // row also renders a checkmark, so its text content is "Dark✓".
    expect(selected[0]).toHaveTextContent(/Dark/);
  });

  it('applies the choice when a mode is tapped', async () => {
    const { getByText } = await render(<ThemePicker />);

    fireEvent.press(getByText('Dark'));

    await waitFor(() => expect(useThemeStore.getState().mode).toBe('dark'));
  });

  it('moves the selection rather than accumulating it', async () => {
    const { getByText, getAllByRole } = await render(<ThemePicker />);

    fireEvent.press(getByText('Dark'));
    await waitFor(() => expect(useThemeStore.getState().mode).toBe('dark'));
    fireEvent.press(getByText('Light'));
    await waitFor(() => expect(useThemeStore.getState().mode).toBe('light'));

    const selected = getAllByRole('radio').filter((r) => r.props.accessibilityState?.selected);
    expect(selected).toHaveLength(1);
  });
});
