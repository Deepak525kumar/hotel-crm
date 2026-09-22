/**
 * Ambient declaration for stylesheet side-effect imports.
 *
 * `theme.ts` does `import '../global.css'`. Inside an Expo APP that resolves
 * through `expo-env.d.ts` (`/// <reference types="expo/types" />`), which
 * declares `*.css` — but that file is GENERATED and gitignored, so it exists
 * on a developer's machine and never in CI. The result was a typecheck that
 * passed locally for everyone and failed on the runner with TS2882, which is
 * the worst shape a build error can have.
 *
 * Declared here, and pulled in by a triple-slash reference from `theme.ts`
 * itself rather than left for each consumer's tsconfig to remember: the file
 * that performs the import is the one that should carry its own types, and a
 * reference travels with it into whatever program compiles it.
 */
declare module '*.css';
