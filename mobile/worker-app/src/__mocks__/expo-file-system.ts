/**
 * The real `expo-file-system` cannot be required under the `unit` project: it
 * is React Native code and throws `__DEV__ is not defined` in a node
 * environment. Every suite that touches `api.documents.upload` therefore needs
 * this, because the native upload path lazily requires the module to build the
 * part it appends.
 *
 * That is worth stating plainly, because the alternative was tried and is
 * worse: a per-file `jest.mock`/`jest.doMock` in each suite. Two suites had
 * one, and whichever ran second still failed -- the module-registry state does
 * not survive the way per-file mocking assumed. Mapping the module once here
 * matches how `react-native`, `expo-secure-store` and `expo-constants` are
 * already handled in this project.
 *
 * `bytes()` is the part of the contract that matters: Expo's WinterCG fetch
 * (the global `fetch` on native) serialises a multipart part only if it is a
 * string, a Blob, or an object exposing `bytes()`.
 */
export class File {
  uri: string;

  constructor(uri: string) {
    this.uri = uri;
  }

  get name(): string {
    return this.uri.split('/').pop() ?? '';
  }

  async bytes(): Promise<Uint8Array> {
    return new Uint8Array([1, 2, 3]);
  }
}
