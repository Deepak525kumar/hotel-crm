import { withPoolSettings } from '../lib/db.js';

// getEnv() throws unless loadEnv() ran, and loading the real env here would
// couple these assertions to whatever DATABASE_POOL_SIZE the developer's
// .env happens to carry. Mocked so the expected numbers below are fixed.
jest.mock('../config/env.js', () => ({
  getEnv: () => ({ DATABASE_POOL_SIZE: 15, DATABASE_POOL_TIMEOUT_S: 10 }),
}));

// These assert the SHAPE of the URL Prisma is handed, because that string is
// the only place the pool size can be expressed -- Prisma exposes no
// constructor option for it. A silent formatting mistake here reverts the
// pool to its 5-connection default with no error anywhere, which is the exact
// condition this module exists to prevent.
describe('withPoolSettings', () => {
  it('adds pool settings to a bare URL', () => {
    const out = new URL(withPoolSettings('postgresql://u:p@h:5432/db'));
    expect(out.searchParams.get('connection_limit')).toBe('15');
    expect(out.searchParams.get('pool_timeout')).toBe('10');
  });

  it('preserves existing query parameters instead of clobbering them', () => {
    // The production URL carries ?schema=public. An implementation that
    // concatenated "?connection_limit=..." would destroy it and connect to
    // the wrong schema.
    const out = new URL(withPoolSettings('postgresql://u:p@h:5432/db?schema=public&sslmode=require'));
    expect(out.searchParams.get('schema')).toBe('public');
    expect(out.searchParams.get('sslmode')).toBe('require');
    expect(out.searchParams.get('connection_limit')).toBe('15');
  });

  it('does not override a connection_limit an operator pinned deliberately', () => {
    const out = new URL(withPoolSettings('postgresql://u:p@h:5432/db?connection_limit=40'));
    expect(out.searchParams.get('connection_limit')).toBe('40');
  });

  it('does not override a pinned pool_timeout', () => {
    const out = new URL(withPoolSettings('postgresql://u:p@h:5432/db?pool_timeout=30'));
    expect(out.searchParams.get('pool_timeout')).toBe('30');
  });

  it('returns a malformed URL untouched, leaving the error to Prisma', () => {
    expect(withPoolSettings('not-a-url')).toBe('not-a-url');
  });
});
