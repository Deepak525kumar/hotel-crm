// expo-secure-store reaches native code that does not exist under jest, and
// the auth store imports it at module load. Mocked here rather than per-test so
// every component test can import a screen without repeating it.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
