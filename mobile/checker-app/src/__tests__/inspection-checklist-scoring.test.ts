import {
  deriveOverallScore,
  invalidChecklistItems,
} from '@/lib/inspection-checklist';

describe('deriveOverallScore', () => {
  it('averages the items that were scored', () => {
    expect(deriveOverallScore({ dust: 80, bathroom: 90, floor: 70 })).toBe(80);
  });

  // "Not assessed" is not "filthy". Counting unscored items as zero would drag
  // a partly-inspected room to a failing score and feed that into the
  // worker's overall rating.
  it('ignores unscored items rather than counting them as zero', () => {
    expect(deriveOverallScore({ dust: 100, bathroom: undefined })).toBe(100);
  });

  it('returns null when nothing was scored, so the caller can block submit', () => {
    expect(deriveOverallScore({})).toBeNull();
    expect(deriveOverallScore({ dust: undefined })).toBeNull();
  });

  it('rounds to an integer, which is what the server accepts', () => {
    // 80 + 85 + 91 = 256 / 3 = 85.33
    expect(deriveOverallScore({ dust: 80, bathroom: 85, floor: 91 })).toBe(85);
    expect(Number.isInteger(deriveOverallScore({ dust: 1, bathroom: 2 }))).toBe(true);
  });

  it('handles the boundaries', () => {
    expect(deriveOverallScore({ dust: 0, bathroom: 0 })).toBe(0);
    expect(deriveOverallScore({ dust: 100, bathroom: 100 })).toBe(100);
  });
});

describe('invalidChecklistItems', () => {
  // The server 400s naming a field the checker cannot see, after the whole
  // form is filled in. Catching it here names the row instead.
  it('names out-of-range items', () => {
    expect(invalidChecklistItems({ dust: 101 })).toEqual(['dust']);
    expect(invalidChecklistItems({ bathroom: -1 })).toEqual(['bathroom']);
  });

  it('rejects a non-integer', () => {
    expect(invalidChecklistItems({ floor: 72.5 })).toEqual(['floor']);
  });

  it('accepts the boundaries and ignores unscored items', () => {
    expect(invalidChecklistItems({ dust: 0, bathroom: 100, mirror: undefined })).toEqual([]);
  });
});
