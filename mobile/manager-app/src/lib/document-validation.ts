// Duplicated from backend/src/modules/documents/upload-policy.ts.
// Client-side UX validation only — the backend remains authoritative.
export const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Pure MIME/size check, kept in its own module (no expo-document-picker
 * import) so it's importable from a plain Jest test under this app's
 * `testEnvironment: node` config without pulling in a native module that
 * fails to parse outside a real RN runtime. Lightweight by design (per
 * review): only MIME + size, never a duplicate of a backend business rule.
 */
// Returns a translation KEY, not a sentence -- same reasoning as
// consent-status.ts: this module is imported by a node-environment test and
// must not depend on i18next init order.
/**
 * Best-effort MIME from a filename, for pickers that return none.
 *
 * `expo-document-picker` leaves `mimeType` undefined for files from some
 * Android providers. That used to pass validation here (the check was guarded
 * on `asset.mimeType` being truthy), and the upload then sent
 * `application/octet-stream`, which the server's `z.enum(ALLOWED_MIME_TYPES)`
 * rejects -- a 422 the worker could do nothing about, on a file that was
 * perfectly acceptable.
 */
export function mimeTypeFromFilename(name: string | undefined): string | undefined {
  const ext = (name ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      return undefined;
  }
}

/**
 * The MIME type to send for a picked asset: what the picker reported, or one
 * derived from the extension when it reported nothing.
 */
export function resolveMimeType(asset: { mimeType?: string; name?: string }): string | undefined {
  return asset.mimeType ?? mimeTypeFromFilename(asset.name);
}

/**
 * Size-only check, for callers that have already established the MIME type by
 * another route.
 *
 * The photo path resolves its own type via `resolvePickedPhoto` (transcoding
 * HEIC to JPEG) and then only needs the size rule. It used to call
 * `validatePickedAsset({ size })`, which was harmless while an absent
 * mimeType passed -- and became a hard rejection of EVERY photo once that
 * function started requiring a resolvable type. Splitting the two rules keeps
 * each caller asking for what it actually means.
 */
export function validateFileSize(size: number | undefined): string | null {
  if (size !== undefined && size > MAX_FILE_SIZE_BYTES) {
    return 'documents.exceedsMaxSize';
  }
  return null;
}

export function validatePickedAsset(asset: {
  mimeType?: string;
  size?: number;
  name?: string;
}): string | null {
  const mime = resolveMimeType(asset);
  // Unknown type is now REJECTED here rather than sent as
  // application/octet-stream for the server to refuse.
  if (!mime || !ALLOWED_MIME_TYPES.includes(mime)) {
    return 'documents.unsupportedType';
  }
  if (asset.size !== undefined && asset.size > MAX_FILE_SIZE_BYTES) {
    return 'documents.exceedsMaxSize';
  }
  return null;
}
