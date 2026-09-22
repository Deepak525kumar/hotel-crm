const _store = new Map<string, string>();

export const getItemAsync = jest.fn((key: string): Promise<string | null> => {
  return Promise.resolve(_store.get(key) ?? null);
});

export const setItemAsync = jest.fn((key: string, value: string): Promise<void> => {
  _store.set(key, value);
  return Promise.resolve();
});

export const deleteItemAsync = jest.fn((key: string): Promise<void> => {
  _store.delete(key);
  return Promise.resolve();
});

export const _reset = (): void => {
  _store.clear();
  getItemAsync.mockClear();
  setItemAsync.mockClear();
  deleteItemAsync.mockClear();
};
