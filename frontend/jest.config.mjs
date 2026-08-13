import nextJest from "next/jest.js";

// next/jest wires up the SWC transform, CSS/asset stubs, tsconfig `paths`
// (so `@/...` resolves), and .env loading — matching how the app is actually
// compiled, rather than maintaining a second parallel Babel/ts-jest setup.
const createJestConfig = nextJest({ dir: "./" });

/** @type {import('jest').Config} */
const config = {
  testEnvironment: "jest-environment-jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  // tsconfig sets `paths` but no `baseUrl`, so next/jest contributes no `@/`
  // entry to moduleNameMapper. Static imports still resolve because SWC
  // rewrites those specifiers at transform time -- but a path passed as a
  // STRING, like jest.mock("@/hooks/useCalendar"), is never rewritten and
  // fails to resolve. Mapping it explicitly makes both forms behave the same.
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    // This workspace has TWO React installs: frontend/node_modules (19.2.4,
    // the version this package depends on) and the hoisted root one (19.2.3).
    // @testing-library/react lives at the root and so resolved the root copy,
    // while the component under test resolved frontend's -- two Reacts in one
    // render, which React reports as "Invalid hook call ... more than one copy
    // of React". It only bites components that actually use hooks, so a
    // stateless component can pass while every stateful one fails. Pin both to
    // this package's copy. The capture group keeps deep imports working
    // (react/jsx-runtime, react-dom/client).
    "^react(/.*)?$": "<rootDir>/node_modules/react$1",
    "^react-dom(/.*)?$": "<rootDir>/node_modules/react-dom$1",
  },
  testMatch: ["<rootDir>/__tests__/**/*.test.{ts,tsx}"],
  // `lint`/`type-check` already cover everything; coverage is reported only
  // for the code under test so the number means something.
  collectCoverageFrom: [
    "app/**/*.{ts,tsx}",
    "components/**/*.{ts,tsx}",
    "lib/**/*.{ts,tsx}",
    "hooks/**/*.{ts,tsx}",
    "!**/*.d.ts",
  ],
};

export default createJestConfig(config);
