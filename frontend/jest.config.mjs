import nextJest from "next/jest.js";

// next/jest wires up the SWC transform, CSS/asset stubs, tsconfig `paths`
// (so `@/...` resolves), and .env loading — matching how the app is actually
// compiled, rather than maintaining a second parallel Babel/ts-jest setup.
const createJestConfig = nextJest({ dir: "./" });

/** @type {import('jest').Config} */
const config = {
  testEnvironment: "jest-environment-jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
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
