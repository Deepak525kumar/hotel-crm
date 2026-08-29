import { readFileSync } from 'fs';
import { join } from 'path';

import { INSPECTION_CHECKLIST_ITEMS } from '@/lib/inspection-checklist';

/**
 * The client's checklist must equal the server's enum.
 *
 * RecordInspectionSchema validates criteria_scores with z.enum(...), so any key
 * this app invents is a 400 naming a field the checker cannot see, after they
 * have filled in the whole form. The identical drift already shipped once in
 * DocumentCategory -- reading both files is the only check that couples them.
 */
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

function serverItems(): string[] {
  const src = readFileSync(
    join(REPO_ROOT, 'backend', 'src', 'modules', 'quality', 'inspection-checklist.ts'),
    'utf8',
  );
  const block = /export const INSPECTION_CHECKLIST_ITEMS = \[([\s\S]*?)\] as const;/.exec(src);
  if (!block) throw new Error('INSPECTION_CHECKLIST_ITEMS not found in the backend module');
  return (block[1].match(/'([a-z_]+)'/g) ?? []).map((q) => q.replace(/'/g, '')).sort();
}

describe('inspection checklist client/server parity', () => {
  it('client list matches the server enum exactly', () => {
    expect([...INSPECTION_CHECKLIST_ITEMS].sort()).toEqual(serverItems());
  });

  // Rejected on write by the server; retained there for reads only.
  it('carries none of the pre-pivot keys', () => {
    for (const legacy of ['punctuality', 'quality', 'attitude']) {
      expect(INSPECTION_CHECKLIST_ITEMS as readonly string[]).not.toContain(legacy);
    }
  });
});
