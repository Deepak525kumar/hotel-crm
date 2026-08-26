import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { api, ApiError } from '@/lib/api';
import { ALLOWED_MIME_TYPES, resolveMimeType, validatePickedAsset } from '@/lib/document-validation';
import { resolvePickedPhoto } from '@/lib/picked-photo';
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
        allowsEditing: false,
        quality: 0.8,
        // The whole point of this path. `Automatic` (the default) lets the
        // system hand back the original representation, which on an iPhone is
        // HEIC -- a type the frozen upload policy does not allow.
        // `Compatible` asks for the most compatible representation, i.e. JPEG.
        // iOS 14+ only, which is why resolvePickedPhoto still checks the type
        // it actually received rather than trusting this.
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      };
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset) return;

      const resolution = resolvePickedPhoto({ mimeType: asset.mimeType, fileName: asset.fileName });
      if (!resolution.ok) {
        setError(t(resolution.errorKey));
        return;
      }

      const sizeError = validatePickedAsset({ size: asset.fileSize });
      if (sizeError) {
        setError(t(sizeError));
        return;
      }

      setPending({
        uri: asset.uri,
        name: resolution.name,
        mimeType: resolution.mimeType,
        size: asset.fileSize,
      });
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

  return { pending, uploading, error, pickFile, pickPhoto, clearPending, upload };
}
