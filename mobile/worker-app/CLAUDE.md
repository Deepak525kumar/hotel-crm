@AGENTS.md

# mobile/worker-app

Expo (SDK 57) app for housekeepers. Its sibling is `mobile/checker-app`.

The line above is written by the Expo tooling — leave it, and read the exact
versioned docs it points at before writing code.

## Gates

```bash
npm run typecheck && npx expo lint && npx jest --forceExit
```

## The two apps are kept in lockstep by a test

`locales.test.ts` asserts this app's locale catalogue **deep-equals** the
frontend's. A key added to the web app alone fails CI here, in a branch that
never touched mobile. Add a string to all three catalogues, or to none — never
add a dead key just to satisfy the assertion; implement the feature.

Most non-locale code in `src/stores/` and `src/lib/api.ts` is intentionally
near-identical between the two apps. Patch both.

## Lint traps that have actually failed CI

- **Assigning a ref during render.** Move it into an effect. This reached
  `main` once and surfaced on the next merge.
- `useState` + an effect to record something derivable is a cascading render;
  `useSyncExternalStore` is what the linter wants for an external capability.

## Network

Every round trip is on mobile data, so a redundant request is visible here in
a way it never is on a desktop LAN. Before adding a call, check whether the
response you need is already being fetched and discarded — that was exactly
the chatbot probe's bug (availability and the chips were two sequential
requests to the same endpoint).

`api.chatbot.isAvailable()` swallows errors on purpose: a 404 means the
feature flag is off and a 403 means this user may not use it, and the correct
UI for both is no assistant. Distinguishing them would leak that an unreleased
feature exists.

## Chatbot client

- Fields arrive **camelCase** — the backend returns its turn object as-is.
- **Honour `turn.status`**: a conversation the server has closed is not
  reusable, and reusing its id gets every later message refused.
