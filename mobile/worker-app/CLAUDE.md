@AGENTS.md

# mobile/worker-app

Expo (SDK 57) app for housekeepers. Its sibling is `mobile/checker-app`.

The line above is written by the Expo tooling — leave it, and read the exact
versioned docs it points at before writing code.

## Read `mobile/CLAUDE.md` first

It holds what is true across all four mobile packages: the gates, the
four-way locale lockstep, the dev-server port trio, the
generated-files-never-in-CI trap, and the icon generator. Only what is
specific to **this** app is below.

## Its twins

Most non-locale code in `src/stores/` and `src/lib/api.ts` is intentionally
near-identical to checker-app and manager-app. Patch the ones that share it.
`mobile/shared/MIGRATION.md` lists every file with a twin, and the
divergences that are decisions rather than drift.

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
