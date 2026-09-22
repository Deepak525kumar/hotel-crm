module.exports = function (api) {
  const isTest = api.env('test');

  // babel-preset-expo in tests too, not a minimal preset-env/typescript pair.
  //
  // The minimal pair was fine while every test was a node-environment `.test.ts`
  // that never rendered anything. It cannot parse JSX, and it cannot parse the
  // Flow annotations inside React Native's own jest setup — which is hoisted to
  // the monorepo root, so it is compiled by this config too. Component tests hit
  // both on the first file they load.
  //
  // The expo preset handles TypeScript, JSX and Flow, which is what jest-expo
  // expects. `api.cache` is keyed on the env, so test and app builds stay
  // separately cached.
  if (isTest) {
    // babel-preset-expo, because the component-test project needs JSX and has
    // to compile React Native's own Flow-annotated internals (hoisted to the
    // monorepo root, so this config reaches them).
    //
    // The `unit` project does NOT use this: jest.config.js gives it an inline
    // transform with `configFile: false`, pinning the minimal preset-env pair
    // it has always used. Expo's preset targets the RN runtime and its output
    // does not load under `testEnvironment: node` with react-native mocked.
    return { presets: ['babel-preset-expo'] };
  }

  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-worklets/plugin MUST be last (Reanimated 4.x requirement).
    // Deliberately not applied under test: it rewrites functions for the UI
    // thread, which does not exist in jest, and nothing under test needs it.
    plugins: ['react-native-worklets/plugin'],
  };
};
