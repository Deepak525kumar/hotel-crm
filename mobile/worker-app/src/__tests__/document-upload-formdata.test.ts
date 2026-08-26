/**
 * What `api.documents.upload` actually puts in the multipart body.
 *
 * THE CONTRACT THIS ENFORCES. Expo replaces the global `fetch` on native with
 * its WinterCG implementation, and that fetch serialises multipart itself.
 * Its converter accepts exactly a string, a Blob, or an object with `bytes()`
 * -- and throws `Unsupported FormDataPart implementation` on anything else.
 * React Native's own legacy {uri, name, type} part is NOT accepted, which is
 * why every native document upload failed while the web client worked.
 *
 * Nothing asserted the body's contents before, which is how two separate
 * broken parts shipped in a row: a truthy-but-non-Blob `file`, and then the
 * {uri} shape that Expo's fetch never supported in the first place.
 *
 * These drive the real module rather than restating its `if`: a test that
 * mirrored the branch would have passed against both broken versions.
 */

type Part = { name: string; value: unknown; filename?: string };

class FakeFormData {
  parts: Part[] = [];
  append(name: string, value: unknown, filename?: string) {
    this.parts.push({ name, value, filename });
  }
}

const ORIGINAL_FORM_DATA = globalThis.FormData;
const ORIGINAL_FETCH = globalThis.fetch;

/** Loads a fresh copy of the api module with FormData and fetch captured. */
function loadApiWithCapture() {
  jest.resetModules();
  (globalThis as { FormData?: unknown }).FormData = FakeFormData;

  // expo-file-system is mapped to src/__mocks__/expo-file-system.ts by the
  // `unit` project: its File exposes bytes(), which is exactly what Expo's
  // fetch requires of a multipart part.

  const sent: { body?: FakeFormData } = {};
  (globalThis as { fetch?: unknown }).fetch = jest.fn(async (_url: string, options: RequestInit) => {
    sent.body = options.body as unknown as FakeFormData;
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { id: 'doc-1' } }),
      headers: { get: () => null },
    };
  });

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { api } = require('@/lib/api');
  return { api, sent };
}

function filePart(form: FakeFormData | undefined): Part {
  const part = form?.parts.find((p) => p.name === 'file');
  if (!part) throw new Error('no file part was appended');
  return part;
}

describe('documents.upload FormData part', () => {
  afterEach(() => {
    (globalThis as { FormData?: unknown }).FormData = ORIGINAL_FORM_DATA;
    (globalThis as { fetch?: unknown }).fetch = ORIGINAL_FETCH;
    jest.resetModules();
  });

  it('sends a part Expo fetch can serialise on native, not the {uri} shape', async () => {
    const { api, sent } = loadApiWithCapture();

    await api.documents.upload(
      'worker-1',
      { uri: 'file:///cache/id.pdf', name: 'id.pdf', mimeType: 'application/pdf' },
      { category: 'ID_CARD' },
    );

    const value = filePart(sent.body).value as Record<string, unknown>;
    // The exact rule from expo/src/winter/fetch/convertFormData.ts: a part
    // must be a string, a Blob, or expose bytes(). A bare {uri} throws.
    expect(typeof (value as { bytes?: unknown }).bytes).toBe('function');
  });

  it('never appends a bare {uri,name,type} object, which Expo fetch rejects', async () => {
    const { api, sent } = loadApiWithCapture();

    await api.documents.upload(
      'worker-1',
      { uri: 'file:///cache/id.pdf', name: 'id.pdf', mimeType: 'application/pdf' },
      { category: 'ID_CARD' },
    );

    const value = filePart(sent.body).value as Record<string, unknown>;
    const isBareUriObject =
      typeof value === 'object' &&
      value !== null &&
      typeof value.uri === 'string' &&
      typeof (value as { bytes?: unknown }).bytes !== 'function' &&
      !(value instanceof Blob);
    expect(isBareUriObject).toBe(false);
  });

  it('ignores a non-Blob `file` rather than trusting whatever the picker set', async () => {
    const { api, sent } = loadApiWithCapture();

    await api.documents.upload(
      'worker-1',
      {
        uri: 'file:///cache/id.pdf',
        name: 'id.pdf',
        mimeType: 'application/pdf',
        file: { some: 'object' },
      },
      { category: 'ID_CARD' },
    );

    const value = filePart(sent.body).value as Record<string, unknown>;
    expect(typeof (value as { bytes?: unknown }).bytes).toBe('function');
  });

  it('uses a real Blob when there is one — the web case', async () => {
    const { api, sent } = loadApiWithCapture();
    const blob = new Blob(['x'], { type: 'application/pdf' });

    await api.documents.upload(
      'worker-1',
      { uri: 'data:application/pdf;base64,eA==', name: 'id.pdf', mimeType: 'application/pdf', file: blob },
      { category: 'ID_CARD' },
    );

    const part = filePart(sent.body);
    expect(part.value).toBe(blob);
    expect(part.filename).toBe('id.pdf');
  });

  it('still sends the text fields the server requires', async () => {
    const { api, sent } = loadApiWithCapture();

    await api.documents.upload(
      'worker-1',
      { uri: 'file:///cache/id.pdf', name: 'id.pdf', mimeType: 'application/pdf' },
      { category: 'ID_CARD' },
    );

    const byName = Object.fromEntries((sent.body?.parts ?? []).map((p) => [p.name, p.value]));
    expect(byName.category).toBe('ID_CARD');
    expect(byName.original_filename).toBe('id.pdf');
    expect(byName.mime_type).toBe('application/pdf');
  });
});
