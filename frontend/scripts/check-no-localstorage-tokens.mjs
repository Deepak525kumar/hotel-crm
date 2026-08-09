#!/usr/bin/env node
/**
 * Regression guard for Security #4 (2026-08-09): auth tokens must never be
 * persisted to `localStorage`. That migration's whole point was moving
 * tokens into httpOnly cookies the browser holds and JS can never read --
 * a single accidental `localStorage.setItem("accessToken", ...)` reintroduces
 * the exact XSS-token-theft surface the migration closed, and nothing else
 * in the build/lint pipeline would catch it (it's valid TypeScript, valid
 * React, passes eslint).
 *
 * No Playwright/test-runner exists in this repo yet, so this is a static
 * check rather than a real browser assertion: it greps the two files that
 * own auth-token handling (`stores/auth.ts`, `lib/api.ts`) for the patterns
 * a regression would introduce -- zustand's `persist` middleware, or a
 * direct `localStorage`/`sessionStorage` call referencing a token-shaped
 * key. It is intentionally narrow (two files, few patterns) rather than a
 * repo-wide grep, to avoid false positives from unrelated legitimate
 * localStorage use elsewhere in the app.
 *
 * Run via `npm run test:no-localstorage-tokens`. Exits non-zero on failure
 * so it's CI-safe without any new dependency.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const FILES = ["stores/auth.ts", "lib/api.ts"];

const FORBIDDEN_PATTERNS = [
  {
    name: "zustand persist middleware",
    pattern: /\bpersist\s*\(/,
  },
  {
    name: "localStorage/sessionStorage write of a token-shaped key",
    pattern: /(localStorage|sessionStorage)\.setItem\(\s*["'`](access|refresh)?[Tt]oken/,
  },
  {
    name: "localStorage/sessionStorage read of a token-shaped key",
    pattern: /(localStorage|sessionStorage)\.getItem\(\s*["'`](access|refresh)?[Tt]oken/,
  },
];

let failed = false;

for (const relPath of FILES) {
  const absPath = path.join(root, relPath);
  const content = readFileSync(absPath, "utf8");

  for (const { name, pattern } of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) {
      failed = true;
      console.error(`FAIL: ${relPath} matches forbidden pattern "${name}" (${pattern}).`);
      console.error(
        "  Auth tokens must live only in httpOnly cookies (Security #4, 2026-08-09) -- " +
          "see this file's own header comment for why.",
      );
    }
  }
}

if (failed) {
  process.exit(1);
}

console.log(`OK: no localStorage/sessionStorage token persistence found in ${FILES.join(", ")}.`);
