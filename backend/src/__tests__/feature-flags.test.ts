import { describe, it, expect, jest, afterEach } from '@jest/globals';

describe('Pivot cutover feature flag (S0-4)', () => {
  afterEach(() => {
    jest.resetModules();
  });

  it('defaults to marketplace mode when PIVOT_MODE is unset', async () => {
    jest.doMock('../config/env.js', () => ({
      getEnv: () => ({ PIVOT_MODE: 'marketplace' }),
    }));

    const { getPivotMode, isDirectDispatchMode } = await import('../config/feature-flags.js');

    expect(getPivotMode()).toBe('marketplace');
    expect(isDirectDispatchMode()).toBe(false);
  });

  it('reports direct_dispatch mode as enabled once toggled', async () => {
    jest.doMock('../config/env.js', () => ({
      getEnv: () => ({ PIVOT_MODE: 'direct_dispatch' }),
    }));

    const { getPivotMode, isDirectDispatchMode } = await import('../config/feature-flags.js');

    expect(getPivotMode()).toBe('direct_dispatch');
    expect(isDirectDispatchMode()).toBe(true);
  });
});
