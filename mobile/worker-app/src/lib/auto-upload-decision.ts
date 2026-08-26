/**
 * Whether a picked document should be uploaded automatically.
 *
 * A pure function rather than a condition inside DocumentChecklistRow's effect,
 * because the interesting case is a loop that a passing render test would not
 * notice: `useDocumentUpload.upload()` leaves `pending` set on failure and
 * flips `uploading` back to false in its `finally`, which is precisely the
 * state the auto-upload effect fires on. Retrying therefore has to be gated on
 * having already attempted THIS file, not on the absence of an error.
 */
export function shouldAutoUpload(args: {
  /** The picked file's uri, or null when nothing is pending. */
  pendingUri: string | null;
  uploading: boolean;
  /** The uri this row has already submitted, if any. */
  attemptedUri: string | null;
}): boolean {
  const { pendingUri, uploading, attemptedUri } = args;
  if (pendingUri === null || uploading) return false;
  return attemptedUri !== pendingUri;
}
