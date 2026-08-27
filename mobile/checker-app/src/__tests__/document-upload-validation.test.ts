import { validateFileSize, validatePickedAsset } from '@/lib/document-validation';

/**
 * SPEC-DOCUMENTS-001@0.1.4 FROZEN (GD-16): client-side MIME/size pre-check
 * only, duplicated from backend/src/modules/documents/upload-policy.ts for
 * UX — the backend remains the authoritative check. Deliberately lightweight
 * per review: no other backend business rule (category, work-permit flag) is
 * duplicated here.
 */
describe('validatePickedAsset', () => {
  it('accepts an allowed MIME type within the size limit', () => {
    expect(validatePickedAsset({ mimeType: 'application/pdf', size: 1024 })).toBeNull();
  });

  it('rejects a disallowed MIME type', () => {
    expect(validatePickedAsset({ mimeType: 'application/zip', size: 1024 })).toBe('documents.unsupportedType');
  });

  it('rejects a file over the 10 MB limit', () => {
    expect(
      validatePickedAsset({ mimeType: 'application/pdf', size: 10 * 1024 * 1024 + 1 }),
    ).toBe('documents.exceedsMaxSize');
  });

  it('accepts a file exactly at the 10 MB limit', () => {
    expect(validatePickedAsset({ mimeType: 'application/pdf', size: 10 * 1024 * 1024 })).toBeNull();
  });

  // This case previously asserted the opposite -- that an undefined mimeType
  // passed here and "deferred to the backend". That deferral was not neutral:
  // the upload then sent `application/octet-stream`, which the server's
  // `z.enum(ALLOWED_MIME_TYPES)` rejects unconditionally. So it deferred to a
  // guaranteed 422 on a file that was often perfectly acceptable, and the
  // worker had no way to act on it. The type is now resolved from the
  // filename first, and only genuinely unidentifiable files are refused.
  it('resolves a missing mimeType from the filename extension', () => {
    expect(validatePickedAsset({ name: 'passport.pdf', size: 1024 })).toBeNull();
    expect(validatePickedAsset({ name: 'id-card.JPG', size: 1024 })).toBeNull();
  });

  it('rejects a file whose type cannot be identified at all', () => {
    // No mimeType and no usable extension: sending octet-stream would only
    // produce a server rejection the worker cannot act on.
    expect(validatePickedAsset({ size: 1024 })).toBe('documents.unsupportedType');
    expect(validatePickedAsset({ name: 'scan.heic', size: 1024 })).toBe('documents.unsupportedType');
  });

  it('still rejects an explicitly unsupported mimeType', () => {
    expect(validatePickedAsset({ mimeType: 'application/zip', name: 'a.pdf' })).toBe(
      'documents.unsupportedType',
    );
  });

  it('does not reject when size is undefined (defers to the backend)', () => {
    expect(validatePickedAsset({ mimeType: 'application/pdf' })).toBeNull();
  });
});

describe('validateFileSize', () => {
  // The photo path knows its own MIME type (resolvePickedPhoto transcodes HEIC
  // to JPEG) and only needs the size rule. It previously called
  // validatePickedAsset({ size }), which silently became a hard rejection of
  // EVERY photo when that function started requiring a resolvable type.
  it('accepts a size-only check, which is all the photo path has', () => {
    expect(validateFileSize(1024)).toBeNull();
  });

  it('accepts an unknown size', () => {
    expect(validateFileSize(undefined)).toBeNull();
  });

  it('rejects over the limit', () => {
    expect(validateFileSize(10 * 1024 * 1024 + 1)).toBe('documents.exceedsMaxSize');
  });

  it('accepts exactly the limit', () => {
    expect(validateFileSize(10 * 1024 * 1024)).toBeNull();
  });
});
