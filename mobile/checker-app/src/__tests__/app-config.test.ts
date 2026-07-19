describe('Pivot cutover feature flag (S0-4)', () => {
  const ORIGINAL_ENV = process.env.EXPO_PUBLIC_PIVOT_MODE;

  afterEach(() => {
    process.env.EXPO_PUBLIC_PIVOT_MODE = ORIGINAL_ENV;
    jest.resetModules();
  });

  it('defaults to marketplace mode when EXPO_PUBLIC_PIVOT_MODE is unset', async () => {
    delete process.env.EXPO_PUBLIC_PIVOT_MODE;
    jest.resetModules();

    const { PIVOT_MODE, isDirectDispatchMode } = await import('@/constants/app-config');

    expect(PIVOT_MODE).toBe('marketplace');
    expect(isDirectDispatchMode()).toBe(false);
  });

  it('reports direct_dispatch mode as enabled once toggled', async () => {
    process.env.EXPO_PUBLIC_PIVOT_MODE = 'direct_dispatch';
    jest.resetModules();

    const { PIVOT_MODE, isDirectDispatchMode } = await import('@/constants/app-config');

    expect(PIVOT_MODE).toBe('direct_dispatch');
    expect(isDirectDispatchMode()).toBe(true);
  });
});
