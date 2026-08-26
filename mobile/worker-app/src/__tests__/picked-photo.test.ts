import { resolvePickedPhoto } from '@/lib/picked-photo';

describe('resolvePickedPhoto', () => {
  it('keeps an already-allowed type rather than relabelling it', () => {
    expect(resolvePickedPhoto({ mimeType: 'image/png', fileName: 'scan.png' }))
      .toEqual({ ok: true, mimeType: 'image/png', name: 'scan.png' });
  });

  // The server validates the mime_type FORM FIELD, not the bytes. Labelling
  // HEIC as JPEG would store an object that can never be opened -- worse than
  // the upload failure this whole path exists to fix.
  it('refuses a disallowed type instead of mislabelling it', () => {
    expect(resolvePickedPhoto({ mimeType: 'image/heic', fileName: 'IMG_1.HEIC' }))
      .toEqual({ ok: false, errorKey: 'documents.unsupportedType' });
  });

  it('assumes jpeg when the platform reports no type', () => {
    const r = resolvePickedPhoto({ mimeType: undefined, fileName: 'IMG_2.jpg' });
    expect(r).toEqual({ ok: true, mimeType: 'image/jpeg', name: 'IMG_2.jpg' });
  });

  // A transcoded HEIC keeps its original filename on some platforms; the
  // extension must follow the bytes, not the source.
  it('rewrites a heic extension once the type is jpeg', () => {
    expect(resolvePickedPhoto({ mimeType: 'image/jpeg', fileName: 'IMG_3.HEIC' }))
      .toMatchObject({ name: 'IMG_3.jpg' });
  });

  it('supplies a filename when the platform reports none', () => {
    expect(resolvePickedPhoto({ mimeType: 'image/jpeg', fileName: null })).toMatchObject({ name: 'photo.jpg' });
    expect(resolvePickedPhoto({ mimeType: 'image/png', fileName: null })).toMatchObject({ name: 'photo.png' });
    expect(resolvePickedPhoto({ mimeType: undefined, fileName: '   ' })).toMatchObject({ name: 'photo.jpg' });
  });
});
