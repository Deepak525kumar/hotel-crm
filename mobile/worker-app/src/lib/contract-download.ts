import { api, getAccessToken } from '@/lib/api';

/**
 * Downloads the signed worker contract and hands it to the OS share sheet.
 *
 * Extracted out of ContractStatusCard so it can actually be tested: this
 * project's `unit` jest project only picks up `**\/__tests__/**\/*.test.ts`,
 * so nothing inside a `.tsx` component is exercised by it.
 *
 * ## Why the native modules are required lazily
 *
 * This module used to open with two TOP-LEVEL imports:
 *
 *     import { File, Paths } from 'expo-file-system';
 *     import * as Sharing from 'expo-sharing';
 *
 * A top-level import of an Expo module whose NATIVE half is not in the running
 * binary throws `Cannot find native module '...'` during module evaluation —
 * which takes down every importer, not just the download button. The same
 * shape took out `shift/[id].tsx` via `expo-location`, where it surfaced as the
 * thoroughly misleading "Route is missing the required default export".
 *
 * That is not hypothetical here: `expo-sharing` is a recent addition
 * (`~57.0.15`), and a development build made before it was added does not
 * contain it until the app is rebuilt. Requiring lazily means a missing module
 * produces a precise, actionable error at the moment the user taps Download,
 * instead of breaking the screen that hosts the button.
 *
 * ## Why the filesystem API is what it is
 *
 * Uses the SDK 54+ `File.downloadFileAsync`, NOT the legacy
 * `FileSystem.downloadAsync`. The legacy name is still exported for migration,
 * but as a stub that unconditionally throws — TypeScript accepts the call
 * because the symbol exists with the right signature, which is exactly why the
 * original implementation shipped broken and silent.
 */

/** Why a download failed, in a form the UI can turn into a real sentence. */
export type ContractDownloadErrorCode =
  /** An Expo module's native half is absent — the app needs rebuilding. */
  | 'NATIVE_MODULE_MISSING'
  /** The server refused or the transfer failed. */
  | 'TRANSFER_FAILED';

export class ContractDownloadError extends Error {
  constructor(
    public readonly code: ContractDownloadErrorCode,
    message: string,
    /** e.g. the missing module's name, for the operator-facing detail line. */
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'ContractDownloadError';
  }
}

export type ContractDownloadResult = {
  uri: string;
  /** `shared` when the OS share sheet opened; `saved` when sharing is unavailable. */
  outcome: 'shared' | 'saved';
};

type FileSystemModule = {
  File: new (...parts: unknown[]) => { uri: string };
  Paths: { document: unknown };
};

type SharingModule = {
  isAvailableAsync: () => Promise<boolean>;
  shareAsync: (uri: string) => Promise<void>;
};

/**
 * `require` rather than a static import, deliberately — a static import is
 * hoisted and evaluated at module load, which is the failure being defended
 * against. Not memoised: these are cheap after the first resolve, and caching a
 * failure would outlive a reload during development.
 */
function requireOptional<T>(load: () => T): T | null {
  try {
    return load();
  } catch {
    return null;
  }
}

export async function downloadContract(workerId: string): Promise<ContractDownloadResult> {
  const fs = requireOptional<FileSystemModule>(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    () => require('expo-file-system') as FileSystemModule,
  );
  if (!fs) {
    throw new ContractDownloadError(
      'NATIVE_MODULE_MISSING',
      'The file system module is missing from this build.',
      'expo-file-system',
    );
  }

  const url = api.hr.getContractDownloadUrl(workerId);
  const token = getAccessToken();

  let file: { uri: string };
  try {
    const { File, Paths } = fs;
    file = await (
      File as unknown as {
        downloadFileAsync: (
          url: string,
          destination: unknown,
          options: Record<string, unknown>,
        ) => Promise<{ uri: string }>;
      }
    ).downloadFileAsync(url, new File(Paths.document, 'contract.pdf'), {
      // The endpoint is authenticated; without this the request is a 401 and
      // the user is told the contract failed to load.
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      // Without this a second download rejects with DestinationAlreadyExists,
      // because the destination filename is fixed. Re-downloading is a normal
      // thing to do, so it overwrites.
      idempotent: true,
    });
  } catch (error) {
    // `downloadFileAsync` rejects with an `UnableToDownload` error carrying the
    // HTTP status on a non-2xx, and creates no file — so an expired session
    // (401) or a scope denial (403) surfaces here rather than silently writing
    // a JSON error body to disk as "contract.pdf".
    throw new ContractDownloadError(
      'TRANSFER_FAILED',
      'The contract could not be downloaded.',
      error instanceof Error ? error.message : String(error),
    );
  }

  // Sharing is OPTIONAL. Its absence must not fail a download that has already
  // succeeded — the bytes are on disk either way, and the caller tells the user
  // where they landed.
  const sharing = requireOptional<SharingModule>(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    () => require('expo-sharing') as SharingModule,
  );
  if (!sharing) return { uri: file.uri, outcome: 'saved' };

  try {
    if (!(await sharing.isAvailableAsync())) return { uri: file.uri, outcome: 'saved' };
    await sharing.shareAsync(file.uri);
    return { uri: file.uri, outcome: 'shared' };
  } catch {
    // The user dismissing the share sheet also lands here on some platforms.
    // The file exists; report it as saved rather than as a failure.
    return { uri: file.uri, outcome: 'saved' };
  }
}
