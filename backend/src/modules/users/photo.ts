// Profile photo storage policy and key generation.
//
// Deliberately its own small module rather than folded into documents/
// upload-policy.ts: identity documents (PDF-or-image, 10MB) and a profile
// photo (image-only, small) are different policies for a different resource
// class, and documents/ owns SPEC-DOCUMENTS-001, not profile photos.
// Reuses documents/storage.ts's StorageClient/getStorageClient() rather than
// a second S3 wiring -- same bucket, same EU-region rule, same encryption.

import crypto from 'node:crypto';

// Profile photos display at small sizes (an avatar, a directory listing) and
// go through S3 on every fresh upload, not a one-time identity check like a
// document scan -- 5MB is a generous cap for a phone photo without inviting
// multi-megabyte uploads on a metered connection.
export const ALLOWED_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Storage key for a user's profile photo.
 *
 * Pattern: profile-photos/{userId}/{uuid4}/{sanitised-filename}, mirroring
 * documents/storage.ts's generateStorageKey. The UUID segment (not the
 * userId prefix) is what makes the key unguessable; re-uploading gives a
 * user a NEW key rather than overwriting the old object in place, so an
 * in-flight presigned/cached reference to the previous photo doesn't start
 * serving someone else's bytes mid-request.
 */
export function generateProfilePhotoKey(userId: string, originalFilename: string): string {
  const uuid = crypto.randomUUID();
  const safeName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  return `profile-photos/${userId}/${uuid}/${safeName}`;
}

// The mime type isn't persisted as its own column -- the key's own filename
// segment (preserved by generateProfilePhotoKey above) already carries the
// extension multer's fileFilter validated at upload time, so re-deriving it
// here avoids a migration for a value the key already encodes. Defaults to
// jpeg (the common case) for the unexpected event of an extension-less key.
export function guessPhotoMimeType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
}
