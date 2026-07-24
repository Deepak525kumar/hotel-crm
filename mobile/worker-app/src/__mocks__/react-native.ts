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
export const Platform: { OS: string } = { OS: 'ios' };
