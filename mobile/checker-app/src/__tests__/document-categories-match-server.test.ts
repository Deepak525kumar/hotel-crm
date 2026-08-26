import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The client's DocumentCategory union must equal the server's Prisma enum.
 *
 * This exists because of a real, shipped defect: the client carried a
 * `GENERAL` member the server had never heard of, AND UploadDocumentCard used
 * it as the DEFAULT dropdown selection. Every worker who picked a file and hit
 * upload without touching the category got
 *
 *     422 Invalid enum value. Expected 'TAX_NUMBER' | ... , received 'GENERAL'
 *
 * — i.e. document upload was broken on its default path, for everyone, while
 * typecheck and the whole suite stayed green because nothing compared the two
 * lists. Reading both files is the only check that actually couples them.
 */
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

function serverCategories(): string[] {
  const schema = readFileSync(join(REPO_ROOT, 'backend', 'prisma', 'schema.prisma'), 'utf8');
  const block = /enum DocumentCategory \{([\s\S]*?)\n\}/.exec(schema);
  if (!block) throw new Error('DocumentCategory enum not found in schema.prisma');
  return block[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => /^[A-Z_]+$/.test(line))
    .sort();
}

function clientCategories(): string[] {
  const types = readFileSync(join(__dirname, '..', 'types', 'api.ts'), 'utf8');
  const decl = /export type DocumentCategory =([^;]*);/.exec(types);
  if (!decl) throw new Error('DocumentCategory type not found in types/api.ts');
  return (decl[1].match(/'([A-Z_]+)'/g) ?? []).map((q) => q.replace(/'/g, '')).sort();
}

describe('DocumentCategory client/server parity', () => {
  it('client union matches the server enum exactly', () => {
    expect(clientCategories()).toEqual(serverCategories());
  });

  it('has no GENERAL member (the category that broke every default upload)', () => {
    expect(clientCategories()).not.toContain('GENERAL');
  });

  it("UploadDocumentCard's default category is one the server accepts", () => {
    const card = readFileSync(
      join(__dirname, '..', 'components', 'documents', 'UploadDocumentCard.tsx'),
      'utf8',
    );
    const def = /const DEFAULT_CATEGORY: DocumentCategory = '([A-Z_]+)'/.exec(card);
    expect(def).not.toBeNull();
    expect(serverCategories()).toContain(def![1]);
  });
});
