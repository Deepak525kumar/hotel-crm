import { describe, it, expect, jest, beforeEach } from '@jest/globals';

import { downloadContract } from '@/lib/contract-download';

/**
 * Contract download (lib/contract-download.ts).
 *
 * This exists because the previous implementation was broken in a way nothing
 * could catch. It called `FileSystem.downloadAsync`, which expo-file-system@57
 * still exports — as a stub that unconditionally throws, to push callers onto
 * the `File`/`Directory` API:
 *
 *     export async function downloadAsync(...) {
 *       throw errorOnLegacyMethodUse('downloadAsync');
 *     }
 *
 * TypeScript accepted the call because the symbol exists with the right
 * signature; the component holding it was a .tsx, which this project's jest
 * config (`**\/__tests__/**\/*.test.ts`) never picks up; and the component
 * swallowed the throw into a generic "failed to load" alert. So every contract
 * download failed and every suite stayed green.
 *
 * Each test below pins something that was independently wrong or missing.
 * Mocks are created inside the jest.mock factories and read back afterwards:
 * ES imports are hoisted above module-scope consts, so a factory referencing
 * an outer `const` hits the temporal dead zone.
 */

jest.mock('expo-file-system', () => {
  const downloadFileAsync = jest.fn();
  class FakeFile {
    uri: string;
    static downloadFileAsync = downloadFileAsync;
    constructor(...parts: any[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : (p?.uri ?? ''))).join('/');
    }
  }
  return { File: FakeFile, Paths: { document: { uri: 'file:///documents' } } };
});

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));

jest.mock('@/lib/api', () => ({
  api: {
    hr: {
      getContractDownloadUrl: (id: string) =>
        `https://api.test/hr/workers/${id}/contract-download`,
    },
  },
  getAccessToken: () => 'test-access-token',
}));

const { File } = require('expo-file-system');
const Sharing = require('expo-sharing');
const downloadFileAsync = File.downloadFileAsync as jest.MockedFunction<(...a: any[]) => any>;
const isAvailableAsync = Sharing.isAvailableAsync as jest.MockedFunction<(...a: any[]) => any>;
const shareAsync = Sharing.shareAsync as jest.MockedFunction<(...a: any[]) => any>;

describe('downloadContract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    downloadFileAsync.mockResolvedValue({ uri: 'file:///documents/contract.pdf' });
    isAvailableAsync.mockResolvedValue(true);
    shareAsync.mockResolvedValue(undefined);
  });

  it('uses File.downloadFileAsync, never the legacy downloadAsync stub', async () => {
    // The whole bug. If this regresses to FileSystem.downloadAsync, the SDK
    // throws and downloadFileAsync is never reached.
    await downloadContract('worker-1');
    expect(downloadFileAsync).toHaveBeenCalledTimes(1);
  });

  it('requests the contract for the given worker', async () => {
    await downloadContract('worker-42');
    const [url] = downloadFileAsync.mock.calls[0] as [string, unknown, unknown];
    // "the correct contract downloads": the worker id must reach the URL, or
    // everyone gets whatever the endpoint defaults to.
    expect(url).toBe('https://api.test/hr/workers/worker-42/contract-download');
  });

  it('sends the bearer token — the endpoint is authenticated', async () => {
    await downloadContract('worker-1');
    const [, , options] = downloadFileAsync.mock.calls[0] as [string, unknown, any];
    expect(options.headers).toEqual({ Authorization: 'Bearer test-access-token' });
  });

  it('passes idempotent so a second download overwrites instead of failing', async () => {
    // The destination filename is fixed, so without this the SDK rejects the
    // second tap with DestinationAlreadyExists.
    await downloadContract('worker-1');
    const [, , options] = downloadFileAsync.mock.calls[0] as [string, unknown, any];
    expect(options.idempotent).toBe(true);
  });

  it('opens the share sheet and reports it', async () => {
    const result = await downloadContract('worker-1');
    expect(shareAsync).toHaveBeenCalledWith('file:///documents/contract.pdf');
    expect(result).toEqual({ uri: 'file:///documents/contract.pdf', outcome: 'shared' });
  });

  it('reports "saved" without sharing when the share sheet is unavailable', async () => {
    isAvailableAsync.mockResolvedValue(false);
    const result = await downloadContract('worker-1');
    expect(shareAsync).not.toHaveBeenCalled();
    expect(result.outcome).toBe('saved');
  });

  it('propagates a non-2xx failure instead of pretending success', async () => {
    // File.downloadFileAsync rejects with the HTTP status and writes no file,
    // so an expired session surfaces rather than leaving a JSON error body on
    // disk named contract.pdf.
    downloadFileAsync.mockRejectedValue(new Error('UnableToDownload: 401'));
    await expect(downloadContract('worker-1')).rejects.toThrow('401');
    expect(shareAsync).not.toHaveBeenCalled();
  });
});
