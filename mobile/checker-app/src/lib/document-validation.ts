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
export function validatePickedAsset(asset: { mimeType?: string; size?: number }): string | null {
  if (asset.mimeType && !ALLOWED_MIME_TYPES.includes(asset.mimeType)) {
    return 'documents.unsupportedType';
  }
  if (asset.size !== undefined && asset.size > MAX_FILE_SIZE_BYTES) {
    return 'documents.exceedsMaxSize';
  }
  return null;
}
