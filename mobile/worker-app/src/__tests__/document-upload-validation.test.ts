import { validatePickedAsset } from '@/lib/document-validation';

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
    expect(validatePickedAsset({ mimeType: 'application/zip', size: 1024 })).toMatch(/unsupported file type/i);
  });

  it('rejects a file over the 10 MB limit', () => {
    expect(
      validatePickedAsset({ mimeType: 'application/pdf', size: 10 * 1024 * 1024 + 1 }),
    ).toMatch(/maximum size/i);
  });

  it('accepts a file exactly at the 10 MB limit', () => {
    expect(validatePickedAsset({ mimeType: 'application/pdf', size: 10 * 1024 * 1024 })).toBeNull();
  });

  it('does not reject when mimeType is undefined (defers to the backend)', () => {
    expect(validatePickedAsset({ size: 1024 })).toBeNull();
  });

  it('does not reject when size is undefined (defers to the backend)', () => {
    expect(validatePickedAsset({ mimeType: 'application/pdf' })).toBeNull();
  });
});
