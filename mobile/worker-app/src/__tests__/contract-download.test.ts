/**
 * The contract download had every failure mode collapse into one useless
 * sentence ("data load failed"), on top of two TOP-LEVEL native imports that
 * could take the whole HR screen down before the button was even tapped.
 *
 * These cases pin the three behaviours that matter to a worker holding a phone:
 * a missing native module is reported as such, a transfer failure carries its
 * real reason, and sharing being unavailable still counts as a successful
 * download because the bytes are on disk.
 */
describe('downloadContract', () => {
  const WORKER = 'worker-1';

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('@/lib/api', () => ({
      api: { hr: { getContractDownloadUrl: (id: string) => `https://api.test/hr/workers/${id}/contract-download` } },
      getAccessToken: () => 'test-token',
    }));
  });

  function mockFileSystem(downloadImpl: () => Promise<{ uri: string }>) {
    class FakeFile {
      static downloadFileAsync = jest.fn(downloadImpl as (...args: unknown[]) => Promise<{ uri: string }>);
      uri = 'file:///documents/contract.pdf';
      constructor(..._parts: unknown[]) {}
    }
    jest.doMock('expo-file-system', () => ({ File: FakeFile, Paths: { document: 'file:///documents' } }));
    return FakeFile;
  }

  it('reports a missing filesystem module as NATIVE_MODULE_MISSING, naming the module', async () => {
    jest.doMock('expo-file-system', () => {
      throw new Error("Cannot find native module 'ExpoFileSystem'");
    });
    const { downloadContract, ContractDownloadError } = require('@/lib/contract-download');

    await expect(downloadContract(WORKER)).rejects.toMatchObject({
      code: 'NATIVE_MODULE_MISSING',
      detail: 'expo-file-system',
    });
    await expect(downloadContract(WORKER)).rejects.toBeInstanceOf(ContractDownloadError);
  });

  it('uses File.downloadFileAsync, never the legacy downloadAsync stub', async () => {
    // Preserved from the original suite: this was the whole of an earlier bug.
    // `FileSystem.downloadAsync` still EXISTS with the right signature, so
    // TypeScript accepts it, but it is a stub that throws unconditionally at
    // runtime — every download failed silently. If the implementation
    // regresses to it, downloadFileAsync is never reached and this fails.
    const FakeFile = mockFileSystem(async () => ({ uri: 'file:///documents/contract.pdf' }));
    jest.doMock('expo-sharing', () => ({
      isAvailableAsync: async () => true,
      shareAsync: async () => undefined,
    }));
    const { downloadContract } = require('@/lib/contract-download');

    await downloadContract(WORKER);

    expect(FakeFile.downloadFileAsync).toHaveBeenCalledTimes(1);
  });

  it('puts the requested worker id in the URL', async () => {
    // "the correct contract downloads": the worker id must reach the URL, or a
    // worker is handed someone else's document.
    const FakeFile = mockFileSystem(async () => ({ uri: 'file:///documents/contract.pdf' }));
    jest.doMock('expo-sharing', () => ({
      isAvailableAsync: async () => true,
      shareAsync: async () => undefined,
    }));
    const { downloadContract } = require('@/lib/contract-download');

    await downloadContract('worker-42');

    const call = FakeFile.downloadFileAsync.mock.calls[0] as unknown as [string, unknown, unknown];
    expect(call[0]).toContain('worker-42');
  });

  it('sends the auth header and overwrites a previous download', async () => {
    const FakeFile = mockFileSystem(async () => ({ uri: 'file:///documents/contract.pdf' }));
    jest.doMock('expo-sharing', () => ({
      isAvailableAsync: async () => true,
      shareAsync: async () => undefined,
    }));
    const { downloadContract } = require('@/lib/contract-download');

    const result = await downloadContract(WORKER);

    expect(result).toEqual({ uri: 'file:///documents/contract.pdf', outcome: 'shared' });
    const call = FakeFile.downloadFileAsync.mock.calls[0] as unknown as [string, unknown, Record<string, unknown>];
    const [url, , options] = call;
    expect(url).toBe(`https://api.test/hr/workers/${WORKER}/contract-download`);
    // Without the header the endpoint 401s and the worker is told the contract
    // failed to load; without idempotent a second download rejects outright.
    expect(options).toMatchObject({
      headers: { Authorization: 'Bearer test-token' },
      idempotent: true,
    });
  });

  it('still counts as a successful download when sharing is missing', async () => {
    mockFileSystem(async () => ({ uri: 'file:///documents/contract.pdf' }));
    jest.doMock('expo-sharing', () => {
      throw new Error("Cannot find native module 'ExpoSharing'");
    });
    const { downloadContract } = require('@/lib/contract-download');

    // The bytes are on disk. Failing here would throw away a download that
    // actually worked, over an optional convenience.
    await expect(downloadContract(WORKER)).resolves.toEqual({
      uri: 'file:///documents/contract.pdf',
      outcome: 'saved',
    });
  });

  it('reports saved, not failed, when the share sheet is dismissed', async () => {
    mockFileSystem(async () => ({ uri: 'file:///documents/contract.pdf' }));
    jest.doMock('expo-sharing', () => ({
      isAvailableAsync: async () => true,
      shareAsync: async () => {
        throw new Error('User dismissed the share sheet');
      },
    }));
    const { downloadContract } = require('@/lib/contract-download');

    await expect(downloadContract(WORKER)).resolves.toMatchObject({ outcome: 'saved' });
  });

  it('carries the underlying reason on a transfer failure', async () => {
    mockFileSystem(async () => {
      throw new Error('UnableToDownload: 403');
    });
    jest.doMock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync: async () => undefined }));
    const { downloadContract } = require('@/lib/contract-download');

    await expect(downloadContract(WORKER)).rejects.toMatchObject({
      code: 'TRANSFER_FAILED',
      detail: 'UnableToDownload: 403',
    });
  });
});

describe('contract-download module', () => {
  it('has no top-level native imports', () => {
    // These are what crashed the importing screen before the button was tapped.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'lib', 'contract-download.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/^import .*from 'expo-file-system'/m);
    expect(src).not.toMatch(/^import .*from 'expo-sharing'/m);
  });
});
