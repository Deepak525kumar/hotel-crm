import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as DocumentPicker from 'expo-document-picker';
import { api, ApiError } from '@/lib/api';
import { ALLOWED_MIME_TYPES, validatePickedAsset } from '@/lib/document-validation';
import type { DocumentCategory, WorkerDocument } from '@/types/api';

export interface PendingUpload {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
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

    setPending({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size });
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
        setError(err instanceof ApiError ? err.message : t('documents.uploadFailed'));
      } finally {
        setUploading(false);
      }
    },
    [pending, workerId, onUploaded, t]
  );

  return { pending, uploading, error, pickFile, clearPending, upload };
}
