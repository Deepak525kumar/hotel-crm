import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { api } from '@/lib/api';
import { ALLOWED_MIME_TYPES, validatePickedAsset } from '@/lib/document-validation';
import type { DocumentCategory, WorkerDocument } from '@/types/api';
import { translateApiError } from '../lib/api-error-i18n';

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

  /**
   * Pick a photo (camera roll or camera) rather than a file.
   *
   * This exists because of HEIC. iPhones shoot in HEIC by default, and
   * `image/heic` is not in ALLOWED_MIME_TYPES -- which is a FROZEN backend
   * policy (SPEC-DOCUMENTS-001@0.1.4), so the fix cannot be to widen the list.
   * Through `expo-document-picker` those photos were either greyed out in the
   * picker or rejected after selection with a type error, which is what
   * "uploading does not work" looked like from the worker's side: the single
   * most common way anyone photographs an ID card was the one path that could
   * not succeed.
   *
   * `expo-image-picker` transcodes to JPEG on the way out, so the bytes that
   * reach the server are already an allowed type. Most identity documents are
   * photographed, not scanned, so this is the primary path, not a convenience.
   */
  const pickPhoto = useCallback(
    async (source: 'camera' | 'library') => {
      setError(null);

      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError(
          t(
            source === 'camera'
              ? 'documents.cameraPermissionDenied'
              : 'documents.libraryPermissionDenied',
          ),
        );
        return;
      }

      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        // Transcode to JPEG. Without this an iOS pick stays HEIC and the
        // server refuses it.
        allowsEditing: false,
        quality: 0.8,
      };
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset) return;

      // The picker reports the ORIGINAL asset's mimeType on some platforms
      // even after transcoding, so trust the transcode and normalise rather
      // than validating a type that no longer describes the bytes.
      const name = asset.fileName?.replace(/\.(heic|heif)$/i, '.jpg') ?? 'photo.jpg';
      const sizeError = validatePickedAsset({ size: asset.fileSize });
      if (sizeError) {
        setError(t(sizeError));
        return;
      }

      setPending({ uri: asset.uri, name, mimeType: 'image/jpeg', size: asset.fileSize });
    },
    [t],
  );

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
        setError(translateApiError(err, t, 'documents.uploadFailed'));
      } finally {
        setUploading(false);
      }
    },
    [pending, workerId, onUploaded, t]
  );

  return { pending, uploading, error, pickFile, pickPhoto, clearPending, upload };
}
