import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as DocumentPicker from 'expo-document-picker';
import { api, ApiError } from '@/lib/api';
import { ALLOWED_MIME_TYPES, resolveMimeType, validatePickedAsset } from '@/lib/document-validation';
import type { DocumentCategory, WorkerDocument } from '@/types/api';
import { translateApiError } from '../lib/api-error-i18n';

export interface PendingUpload {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
  /** Web only — the real File object, preferred over `uri` when present. */
  file?: unknown;
}

/**
 * Owns the pick -> validate -> upload -> retry cycle for one worker document
 * upload. Presentational components (UploadDocumentCard) consume this and
 * render only — no picker/validation/upload logic lives in the component.
 */
export function useDocumentUpload(workerId: string, onUploaded: (doc: WorkerDocument) => void) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickFile = useCallback(async () => {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: ALLOWED_MIME_TYPES,
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset) return;

    const validationError = validatePickedAsset(asset);
    if (validationError) {
      // validatePickedAsset returns a key, not a sentence.
      setError(t(validationError));
      return;
    }

    // Resolved, not raw: the picker can report no MIME type at all, and the
    // server only accepts a known one.
    setPending({
      uri: asset.uri,
      name: asset.name,
      mimeType: resolveMimeType(asset),
      size: asset.size,
      file: (asset as { file?: unknown }).file,
    });
  }, [t]);

  const clearPending = useCallback(() => {
    setPending(null);
    setError(null);
  }, []);

  const upload = useCallback(
    async (input: { category: DocumentCategory; is_work_permit?: boolean; expires_at?: string }) => {
      if (!pending) return;
      setError(null);
      setUploading(true);
      try {
        const doc = await api.documents.upload(workerId, pending, input);
        onUploaded(doc);
        setPending(null);
      } catch (err) {
        // A server rejection (4xx/5xx) arrives as an ApiError carrying the
        // server's own message, and translateApiError shows it verbatim.
        // Anything else means `fetch` itself threw -- the request never got a
        // response at all, which for a multipart upload almost always means
        // the native layer could not read the picked file. That case used to
        // collapse into a bare "Upload failed. Please try again.", which named
        // nothing and made the failure undiagnosable from a device. Keep the
        // underlying reason.
        if (err instanceof ApiError) {
          setError(translateApiError(err, t, 'documents.uploadFailed'));
        } else {
          const reason = err instanceof Error ? err.message : String(err);
          setError(t('documents.uploadFailedReason', { reason }));
        }
      } finally {
        setUploading(false);
      }
    },
    [pending, workerId, onUploaded, t]
  );

  return { pending, uploading, error, pickFile, clearPending, upload };
}
