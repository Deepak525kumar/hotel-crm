/**
 * What `api.documents.upload` actually puts in the multipart body.
 *
 * Nothing tested this, which is how a truthiness check on `asset.file` shipped
 * and broke every NATIVE upload with React Native's own
 *
 *     Unsupported FormDataPart implementation
 *
 * RN's FormData accepts a string, or an object with a string `uri`, and
 * nothing else. expo-document-picker can hand back a `file` on native that is
 * neither, so preferring it whenever it was merely truthy produced a part RN
 * refused to encode. The web branch must be taken only for a genuine Blob.
 *
 * This drives the real module rather than restating its `if`: a test that
 * mirrors the branch would have passed against the broken code too.
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

  it('sends the {uri,name,type} shape on native — the only shape RN accepts', async () => {
    const { api, sent } = loadApiWithCapture();

    await api.documents.upload(
      'worker-1',
      { uri: 'file:///cache/id.pdf', name: 'id.pdf', mimeType: 'application/pdf' },
      { category: 'ID_CARD' },
    );

    expect(filePart(sent.body).value).toEqual({
      uri: 'file:///cache/id.pdf',
      name: 'id.pdf',
      type: 'application/pdf',
    });
  });

  it('ignores a non-Blob `file` rather than handing RN a part it cannot encode', async () => {
    const { api, sent } = loadApiWithCapture();

    await api.documents.upload(
      'worker-1',
      {
        uri: 'file:///cache/id.pdf',
        name: 'id.pdf',
        mimeType: 'application/pdf',
        // The regression: truthy, but not a Blob.
        file: { some: 'object' },
      },
      { category: 'ID_CARD' },
    );

    const value = filePart(sent.body).value as Record<string, unknown>;
    expect(typeof value.uri).toBe('string');
    expect(value.uri).toBe('file:///cache/id.pdf');
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
