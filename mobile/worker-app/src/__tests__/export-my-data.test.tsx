import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';

// RNTL 14 pairs with React 19's async test renderer: `render` returns a
// Promise, so every test awaits it.

import { ExportMyDataRow } from '@/components/settings/ExportMyDataRow';
import { api } from '@/lib/api';

/**
 * "Export my data" on mobile.
 *
 * The states worth testing are the ones a person on a phone actually hits and
 * that are easy to get wrong: the file is a LINK handed to the OS rather than
 * bytes, the link can legitimately be absent, and a device may refuse to open
 * it. None of those may look like success.
 */

jest.mock('@/lib/api', () => ({
  api: { reports: { exportMine: jest.fn() } },
}));

const exportMine = api.reports.exportMine as jest.MockedFunction<typeof api.reports.exportMine>;

const REPORT = {
  filename: 'own-data-2026-09-08.xlsx',
  url: 'https://example.test/reports/abc.xlsx',
  format: 'xlsx' as const,
  rowCount: 42,
  truncated: false,
};

describe('ExportMyDataRow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true as never);
  });

  const lastAlertBody = () =>
    String(((Alert.alert as unknown as jest.Mock).mock.calls[0] ?? [])[1] ?? '');

  it('offers the export to whoever is looking, with no role gate', async () => {
    // A legal right, not a management feature. This component must never grow
    // a role check, so there is no role to pass it.
    const { getByText } = await render(<ExportMyDataRow />);
    expect(getByText(/export my data/i)).toBeTruthy();
  });

  it('hands the link to the OS rather than downloading bytes', async () => {
    // A phone must not hold a year of somebody's history in memory, and an
    // .xlsx is not something this app can usefully display anyway.
    exportMine.mockResolvedValue(REPORT);
    const { getByText } = await render(<ExportMyDataRow />);

    fireEvent.press(getByText(/export my data/i));

    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(REPORT.url));
  });

  it('reports missing storage instead of opening nothing', async () => {
    // A null URL is a real state (storage unconfigured server-side), not an
    // error to hide behind a silent no-op.
    exportMine.mockResolvedValue({ ...REPORT, url: null });
    const { getByText } = await render(<ExportMyDataRow />);

    fireEvent.press(getByText(/export my data/i));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(lastAlertBody()).toMatch(/file storage/i);
  });

  it('says so when the device cannot open the link', async () => {
    exportMine.mockResolvedValue(REPORT);
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false as never);
    const { getByText } = await render(<ExportMyDataRow />);

    fireEvent.press(getByText(/export my data/i));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    // Calling openURL and having nothing visibly happen is the worse failure.
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('surfaces a failure rather than appearing to succeed', async () => {
    exportMine.mockRejectedValue(new Error('Report generation failed'));
    const { getByText } = await render(<ExportMyDataRow />);

    fireEvent.press(getByText(/export my data/i));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(lastAlertBody()).toMatch(/report generation failed/i);
  });
});
