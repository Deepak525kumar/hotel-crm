import { ALLOWED_MIME_TYPES } from '@/lib/document-validation';

/**
 * Resolves the mime type and filename to upload a picked photo under.
 *
 * The server does not sniff content -- `uploadDocumentSchema` validates the
 * `mime_type` FORM FIELD against the allowlist, and stores whatever bytes
 * arrive. So a wrong label is not rejected, it is persisted: the object is
 * served later as something it is not, and cannot be opened.
 *
 * That makes the HEIC case delicate. `expo-image-picker` is asked for
 * `Compatible` representation, which transcodes an iPhone's HEIC to JPEG, but
 * the option is iOS 14+ and the default (`Automatic`) makes no such promise.
 * If a disallowed type still arrives, the transcode did not happen, and
 * relabelling it would be worse than refusing it.
 */
export type PickedPhotoResolution =
  | { ok: true; mimeType: string; name: string }
  | { ok: false; errorKey: string };

export function resolvePickedPhoto(asset: { mimeType?: string; fileName?: string | null }): PickedPhotoResolution {
  const { mimeType } = asset;

  if (mimeType && !ALLOWED_MIME_TYPES.includes(mimeType)) {
    return { ok: false, errorKey: 'documents.unsupportedType' };
  }

  // Absent mimeType means the platform did not report one (seen on some
  // Android providers). JPEG is the correct assumption for a camera/library
  // photo, and it is an allowed type either way.
  const resolved = mimeType ?? 'image/jpeg';
  const base = asset.fileName?.trim();
  const name =
    base && base.length > 0
      ? resolved === 'image/jpeg'
        ? base.replace(/\.(heic|heif)$/i, '.jpg')
        : base
      : `photo.${resolved === 'image/png' ? 'png' : resolved === 'image/webp' ? 'webp' : 'jpg'}`;

  return { ok: true, mimeType: resolved, name };
}
