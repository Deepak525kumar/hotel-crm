import { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';

/** What React Native's FormData needs for a file part. */
export interface PickedPhoto {
  uri: string;
  name: string;
  type: string;
}

// Mirrors the server's limits (backend quality/types.ts) so a photo that would
// be rejected is never uploaded over a hotel wifi connection. The server stays
// authoritative.
export const MAX_PHOTOS = 6;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

function toPhoto(asset: ImagePicker.ImagePickerAsset): PickedPhoto {
  // `fileName` is absent on some Android providers; fall back to the last URI
  // segment so the server always receives a filename to sanitise.
  const name = asset.fileName ?? asset.uri.split('/').pop() ?? 'photo.jpg';
  return { uri: asset.uri, name, type: asset.mimeType ?? 'image/jpeg' };
}

/**
 * Camera + library picking for quality evidence (CRR §14/§15).
 *
 * Both sources are offered deliberately: a checker inspecting a room or a
 * worker finishing rework is standing in front of the thing they need to
 * photograph, so the camera is the primary path -- but the library matters
 * when the photo was already taken, or when the camera permission is denied.
 */
export function usePhotoPicker() {
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const accept = useCallback(
    (assets: ImagePicker.ImagePickerAsset[]) => {
      setError(null);
      const next = [...photos];
      for (const asset of assets) {
        if (next.length >= MAX_PHOTOS) {
          setError(t('quality.tooManyPhotos', { max: MAX_PHOTOS }));
          break;
        }
        if ((asset.fileSize ?? 0) > MAX_PHOTO_BYTES) {
          setError(
            t('quality.photoTooLarge', {
              name: asset.fileName ?? 'photo',
              mb: Math.floor(MAX_PHOTO_BYTES / (1024 * 1024)),
            })
          );
          continue;
        }
        next.push(toPhoto(asset));
      }
      setPhotos(next);
    },
    [photos, t]
  );

  const takePhoto = useCallback(async () => {
    // Permission is requested at the point of use, not on mount: asking for
    // the camera before the user has chosen to attach anything is the pattern
    // that gets denied, and a denial is sticky.
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError(t('quality.cameraDenied'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled) accept(result.assets);
  }, [accept, t]);

  const pickFromLibrary = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS,
      quality: 0.7,
    });
    if (!result.canceled) accept(result.assets);
  }, [accept]);

  const removeAt = useCallback((index: number) => {
    setPhotos((current) => current.filter((_, i) => i !== index));
  }, []);

  const reset = useCallback(() => {
    setPhotos([]);
    setError(null);
  }, []);

  return { photos, error, takePhoto, pickFromLibrary, removeAt, reset };
}
