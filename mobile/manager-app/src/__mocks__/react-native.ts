// Minimal `react-native` stand-in for the node test environment, mapped via
// jest moduleNameMapper (same approach as expo-secure-store).
//
// The real package ships untranspiled ESM, so importing it under
// `testEnvironment: node` fails unless the whole RN transform chain is added
// to transformIgnorePatterns — slow, and pointless for logic tests that only
// need to know which platform they are on. Type-checking still resolves the
// REAL react-native types (tsconfig.test.json is unaffected by
// moduleNameMapper), so this mock cannot mask a type error.
//
// `OS` is mutable so a test can exercise the ios / android / web branches.
/**
 * `select` added 2026-09-22, and it is not cosmetic.
 *
 * Without it any test that reaches `constants/theme.ts` -- which every import
 * of the shared package's barrel does -- fails at import time with
 * "Platform.select is not a function", before a single assertion runs. The
 * failure names the theme file rather than the missing mock, so it reads as a
 * broken theme.
 *
 * This is the same trap jest.config.js already records from the other side:
 * an automatic __mocks__ double that beats moduleNameMapper gave component
 * tests a react-native whose Platform had only `OS`, and nothing rendered.
 */
export const Platform: {
  OS: string;
  select: <T>(specifics: { ios?: T; android?: T; native?: T; default?: T }) => T | undefined;
} = {
  OS: 'ios',
  // Mirrors the real implementation's precedence for OS 'ios'.
  select: (specifics) =>
    'ios' in specifics
      ? specifics.ios
      : 'native' in specifics
        ? specifics.native
        : specifics.default,
};
