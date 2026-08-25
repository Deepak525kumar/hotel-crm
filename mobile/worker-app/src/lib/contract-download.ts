import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { api, getAccessToken } from '@/lib/api';

/**
 * Downloads the signed worker contract and hands it to the OS share sheet.
 *
 * Extracted out of ContractStatusCard so it can actually be tested: this
 * project's jest config only picks up `**\/__tests__/**\/*.test.ts`, so nothing
 * inside a `.tsx` component is exercised by any suite. The previous
 * implementation lived in the component and was broken in a way no test and no
 * typecheck could see (see below).
 *
 * Uses the SDK 54+ filesystem API (`File.downloadFileAsync`), NOT the legacy
 * `FileSystem.downloadAsync`. The legacy name is still exported from
 * `expo-file-system` for migration purposes, but as a stub that
 * unconditionally throws:
 *
 *     export async function downloadAsync(...) {
 *       throw errorOnLegacyMethodUse('downloadAsync');
 *     }
 *
 * TypeScript accepts the call because the symbol exists with the right
 * signature, which is exactly why this shipped: every download attempt threw
 * at runtime and was swallowed into a generic "failed to load" alert. Verified
 * against the installed expo-file-system@57.0.5 sources, not from memory.
 *
 * Error handling is deliberately left to the caller. `File.downloadFileAsync`
 * rejects with an `UnableToDownload` error carrying the HTTP status when the
 * server answers non-2xx, and creates no file in that case — so an expired
 * session (401) or a scope denial (403) surfaces as a rejection rather than
 * silently writing a JSON error body to disk as "contract.pdf".
 */
export type ContractDownloadResult = {
  uri: string;
  /** `shared` when the OS share sheet opened; `saved` when sharing is unavailable. */
  outcome: 'shared' | 'saved';
};

export async function downloadContract(workerId: string): Promise<ContractDownloadResult> {
  const url = api.hr.getContractDownloadUrl(workerId);
  const token = getAccessToken();

  const file = await File.downloadFileAsync(url, new File(Paths.document, 'contract.pdf'), {
    // The endpoint is authenticated; without this the request is a 401 and the
    // user is told the contract failed to load.
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    // Without this a second download rejects with DestinationAlreadyExists,
    // because the destination filename is fixed. Re-downloading is a normal
    // thing to do, so it overwrites.
    idempotent: true,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri);
    return { uri: file.uri, outcome: 'shared' };
  }

  return { uri: file.uri, outcome: 'saved' };
}
