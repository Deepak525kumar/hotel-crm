import { isVersionGreater } from '../compare-versions';

describe('isVersionGreater', () => {
  it('correctly evaluates standard integers (backward compatibility)', () => {
    expect(isVersionGreater('2', '1')).toBe(true);
    expect(isVersionGreater('1', '2')).toBe(false);
    expect(isVersionGreater('1', '1')).toBe(false);
  });

  it('correctly evaluates dot notation', () => {
    expect(isVersionGreater('1.2.0', '1.1.0')).toBe(true);
    expect(isVersionGreater('1.1.0', '1.2.0')).toBe(false);
  });

  it('handles multi-digit segments mathematically, not lexically', () => {
    // "1.10.0" > "1.2.0"
    expect(isVersionGreater('1.10.0', '1.2.0')).toBe(true);
    expect(isVersionGreater('1.2.0', '1.10.0')).toBe(false);
  });

  it('handles missing segments correctly', () => {
    // "1.2" == "1.2.0"
    expect(isVersionGreater('1.2', '1.2.0')).toBe(false);
    expect(isVersionGreater('1.2.1', '1.2')).toBe(true);
    expect(isVersionGreater('1.3', '1.2.9')).toBe(true);
  });

  it('handles empty or missing strings safely', () => {
    expect(isVersionGreater('', '1.0.0')).toBe(false);
    expect(isVersionGreater('1.0.0', '')).toBe(false);
  });
});
