/**
 * Downloads a generated report and hands it to the share sheet.
 *
 * This is deliberately built the same way as `contract-download.ts`, and for
 * the same reasons that module records at length. Two of them are not
 * optional:
 *
 * 1. **The native modules are required LAZILY.** A top-level import of an
 *    Expo module whose native half is absent from the running binary throws
 *    during module evaluation and takes down every importer — the whole
 *    Settings screen, not just this button.
 *
 * 2. **`File.downloadFileAsync`, never `FileSystem.downloadAsync`.** The
 *    legacy name is still exported in SDK 57 as a stub that unconditionally
 *    THROWS. TypeScript accepts the call because the symbol exists with the
 *    right signature, which is exactly how the contract download originally
 *    shipped broken and silent. I reached for it here too, and the compiler
 *    caught it only because `cacheDirectory` happened to be gone as well.
 *
 * Reports land in the DOCUMENT directory rather than the cache: a manager
 * exports one in order to send it, and a cache the OS may evict between
 * generating and sharing is the wrong place for a file someone is about to
 * attach to an email.
 */

type FileSystemModule = {
  File: unknown;
  Paths: { document: unknown };
};

type SharingModule = {
  isAvailableAsync: () => Promise<boolean>;
  shareAsync: (uri: string) => Promise<void>;
};

function requireOptional<T>(load: () => T): T | null {
  try {
    return load();
  } catch {
    return null;
  }
}

export type ExportOutcome =
  | { ok: true; uri: string; shared: boolean }
  | { ok: false; reason: 'NATIVE_MODULE_MISSING' | 'TRANSFER_FAILED'; detail?: string };

export async function openExport(url: string, filename: string): Promise<ExportOutcome> {
  const fs = requireOptional<FileSystemModule>(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    () => require('expo-file-system') as FileSystemModule,
  );
  if (!fs) return { ok: false, reason: 'NATIVE_MODULE_MISSING' };

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
    ).downloadFileAsync(url, new (File as new (...args: unknown[]) => unknown)(Paths.document, filename), {
      // The export URL is presigned and short-lived, so no Authorization
      // header is sent — unlike the contract route, which is authenticated.
      // Overwriting matters for the same reason: re-exporting is normal, and
      // a fixed filename would otherwise reject with DestinationAlreadyExists.
      idempotent: true,
    });
  } catch (error) {
    // A non-2xx rejects and creates no file, so an expired link surfaces here
    // rather than silently writing an error body to disk as a .xlsx.
    return {
      ok: false,
      reason: 'TRANSFER_FAILED',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  // Sharing is OPTIONAL: its absence must not fail a download that already
  // succeeded. The file is on disk either way.
  const sharing = requireOptional<SharingModule>(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    () => require('expo-sharing') as SharingModule,
  );
  if (sharing && (await sharing.isAvailableAsync())) {
    await sharing.shareAsync(file.uri);
    return { ok: true, uri: file.uri, shared: true };
  }
  return { ok: true, uri: file.uri, shared: false };
}
