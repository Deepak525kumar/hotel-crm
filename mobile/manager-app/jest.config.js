/**
 * Two projects, deliberately.
 *
 * `unit` is the pre-existing configuration, unchanged: node environment,
 * `react-native` replaced by a hand-written mock, and only `.test.ts`
 * collected. Everything already written depends on that shape.
 *
 * `components` is new, and exists because nothing in this app's `.tsx` files
 * was reachable by any test. Five of the eight defects found in the 2026-08-25
 * mobile flow verification lived in `.tsx` and passed typecheck: contract
 * download threw on every attempt, onboarding submission 404'd, marking a
 * vacation always failed. A green suite said nothing about any of them.
 *
 * The two cannot share one config: `unit` mocks the whole of `react-native`,
 * so rendering a component under it is impossible, while jest-expo needs the
 * real module. Splitting keeps the existing suite untouched rather than
 * rewriting ~200 passing tests to gain component coverage.
 */
const unit = {
  displayName: 'unit',
  testEnvironment: 'node',
  // `configFile: false` deliberately ignores babel.config.js. That file now
  // returns babel-preset-expo under test for the component project's sake, and
  // Expo's preset targets the React Native runtime — its output does not load
  // in a node environment with react-native mocked. Pinning the presets here
  // keeps this project byte-for-byte the configuration these ~200 tests were
  // written against.
  transform: {
    '^.+\\.tsx?$': [
      'babel-jest',
      {
        configFile: false,
        babelrc: false,
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          '@babel/preset-typescript',
        ],
      },
    ],
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    // BEFORE the alias, and present in BOTH projects: theme.ts imports
    // global.css, and anything that reaches theme (the shared barrel does)
    // hands a stylesheet to jest, which cannot parse CSS. The stylesheet
    // contributes nothing to a node-environment assertion.
    '\\.css$': '<rootDir>/src/test-support/style-mock.js',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^expo-secure-store$': '<rootDir>/src/__mocks__/expo-secure-store.ts',
    '^react-native$': '<rootDir>/src/__mocks__/react-native.ts',
    '^expo-constants$': '<rootDir>/src/__mocks__/expo-constants.ts',
    '^expo-file-system$': '<rootDir>/src/__mocks__/expo-file-system.ts',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
};

const components = {
  displayName: 'components',
  // The single-platform preset, not the root 'jest-expo': that one is itself a
  // multi-project config, and nesting projects inside projects silently yields
  // a half-configured environment (Platform.select undefined). One platform is
  // enough here — these tests assert on behaviour and accessibility, not on
  // per-platform rendering.
  preset: 'jest-expo/ios',
  // .tsx only: `unit` already owns .test.ts, and a file cannot belong to both.
  testMatch: ['**/__tests__/**/*.test.tsx'],
  moduleNameMapper: {
    // BEFORE the '@/' alias: moduleNameMapper is ordered and first match wins,
    // so the alias would otherwise rewrite '@/global.css' to a real path and
    // hand the stylesheet to jest, which cannot parse CSS. The stylesheet
    // contributes nothing to a rendered assertion.
    '\\.css$': '<rootDir>/src/test-support/style-mock.js',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // src/__mocks__ holds hand-written doubles for the `unit` project, which maps
  // them explicitly. jest ALSO auto-applies a `__mocks__/<node module>` file
  // wherever it finds one, and that automatic mock beats moduleNameMapper — so
  // component tests silently got a react-native whose Platform had only `OS`,
  // and nothing rendered. Ignoring the directory here restores the real
  // modules; the `unit` project is a separate project and is unaffected.
  // (This is why style-mock.js lives in src/test-support instead.)
  modulePathIgnorePatterns: ['<rootDir>/src/__mocks__/'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.components.js'],
};

module.exports = { projects: [unit, components] };
