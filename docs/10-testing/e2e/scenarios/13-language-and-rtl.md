# Scenario 13 — Language Selection and RTL Rendering

**New scenario, added 2026-09-02** (closing the oldest and, per the README's own note, least
specified of the three long-standing gaps — first recorded 2026-08-22, shipped in PRs
#471–#484 with **no governing specification**, only an owner decision recorded directly in
`lib/locales.ts`'s own comments). All steps below were run live against a real Postgres/browser
stack on 2026-09-02 — this pass found and fixed two real, related defects, described in full
below rather than just asserted.

**Preconditions:** Scenario 00 complete. A real Worker account.

**What "six locales" means precisely:** `de en ur ar fr uk` (`lib/locales.ts` `UI_LOCALES`,
owner decision 2026-08-16). `ar`/`ur` are RTL (`RTL_UI_LOCALES`). This is a **narrower and
separate** list from consent's own `SUPPORTED_LANGUAGES` (13 languages of legal notice
content, `SPEC-CONSENT-001`/`ADR-068`) — `UI_LOCALES` must stay a subset of that list (enforced
by `preferred-language.test.ts`) so a worker always gets the consent notice in the language
they picked for the UI chrome, but the reverse doesn't hold: a language can be legally noticed
without the UI itself being translated into it.

---

## Step 1 — Persistence: all six locales, and only those six

```bash
curl -s -X PUT http://localhost:3001/api/v1/auth/profile -H "Authorization: Bearer $WT" \
  -H 'Content-Type: application/json' -d '{"preferred_language":"ar"}'
```

**PASS (verified live):** each of `de en ur ar fr uk` persists and round-trips exactly.
`{"preferred_language":"es"}` → `422`, `"Invalid enum value. Expected 'de' | 'en' | 'ur' |
'ar' | 'fr' | 'uk', received 'es'"` — the six-locale set is a hard enum boundary, not a
soft suggestion a client could smuggle a seventh value past.

## Step 2 — REAL DEFECT #1 (fixed): a fresh login renders in the wrong language, indefinitely

**Symptom, found live:** set `preferred_language: "ar"`, then log in as that worker through
the real login form in a real browser. Immediately after login: `<html dir="ltr" lang="en">`,
body text in English. Waited 5 seconds — no change. Manually reloaded the page — **correct**:
`dir="rtl"`, `lang="ar"`, real Arabic UI text. The bug is specifically "works after a reload,
never applies on the login that just happened."

**Root cause:** `POST /auth/login`'s response omitted `preferred_language` from the `user`
object entirely, while `GET /auth/me` (`getCurrentUser`) has always included it. This is the
exact same bug *class* this file's own service code has hit twice before for different fields
— see the `2026-08-13` comment beside `employment_status` and the profile-photo comment right
below it in `auth/service.ts`'s `login()` — a field the client needs immediately, present on
the reload-time endpoint, missing from the fresh-login one. `LocaleProvider` reconciles the UI
language from `user.preferred_language` the instant auth settles; with it `undefined` on a
fresh login, there was nothing to reconcile against until the next full page load pulled it
from `/auth/me` instead.

**Fixed:** `preferred_language` added to `login()`'s (and `signup()`'s — always `null` there,
correctly, since a signup has never had the chance to choose one) response, added to the
shared `AuthUser` type. Two new unit tests in `auth.test.ts`.

## Step 3 — REAL DEFECT #2 (fixed): the backend fix alone was not sufficient

**Re-running Step 2's exact repro after Fix #1** still failed identically — `ltr`/`en`, no
change after 5 seconds. Confirmed via the browser's own network inspection that the fixed
`preferred_language: "ar"` really was arriving in the login response body. The remaining bug
was entirely client-side.

**Root cause:** the locale store's `reconciled` flag is a one-way gate — `LocaleProvider`'s
reconciliation effect only runs `if (!reconciled)`. The **public, unauthenticated** login
screen itself already reconciles (so it can render in a negotiated language too — a real,
separate, correct feature) and sets `reconciled: true` as a side effect. `router.replace(
"/dashboard")` after a successful login is client-side navigation — `LocaleProvider` never
remounts, so `reconciled` never resets, and the effect's own guard then **silently skips**
reconciling against the just-authenticated user's real preference for the rest of that page
session. Only a full reload (a fresh mount, `reconciled` starting at `false` again) ever
applied it.

**Fixed:** `stores/auth.ts`'s `setUser` — the one call in the app that only ever carries fresh,
authoritative server data (login, signup, `/auth/me` revalidation) — now calls
`reconcileFromServer` **directly and unconditionally**, bypassing the `reconciled` gate
entirely rather than trying to teach that flag to distinguish "never reconciled" from
"reconciled against the wrong, pre-login state." `reconcileFromServer` is itself idempotent
(no-ops when nothing changed), so this is safe to call on every `setUser`.

**A real circular-require surfaced while fixing this**, worth recording so it isn't
rediscovered: `lib/api.ts` already imports `stores/auth.ts` (for 401/`TOKEN_REVOKED`
handling), and `stores/locale.ts` imports `authApi` from `lib/api.ts` — a static top-level
`import { useLocaleStore } from "./locale"` in `stores/auth.ts` closes that into a genuine
cycle (`api.ts → auth.ts → locale.ts → api.ts`), which broke module evaluation under Jest/CJS
interop (`ReferenceError: Cannot access 'ApiError' before initialization`) in any test file
whose require order happened to hit it. Fixed with a lazily-`require()`'d reference inside
`setUser` itself, so `stores/auth.ts`'s own top-level evaluation never touches `locale.ts` at
all — only the function body does, once, at call time, after the whole module graph has
already finished loading.

**Verified live, both fixes together:** the exact original repro — set `preferred_language:
"ar"` via the API, then a genuinely fresh login through the real form — now shows `dir="rtl"`,
`lang="ar"`, and correctly-rendered Arabic body text (`الإعدادات`, `تسجيل الخروج`, `انضمامي`,
`غير نشط`), with **no reload**. One new regression test in `LocaleProvider.test.tsx`, calling
the real `setUser` action directly (not `.setState`) so it actually exercises the fix rather
than the component effect the earlier tests in that file deliberately bypass.

---

## Pass criteria summary

- [x] All six locales persist via `PUT /auth/profile`; a seventh is rejected with the exact
      enum list
- [x] A fresh login (no reload) renders the correct language AND, for `ar`/`ur`, the correct
      text direction — **was broken two ways, both found and fixed live this pass**
- [ ] Consent notice language following the selected locale — already covered separately in
      scenario 11 Step 9 (`uk`/`ar`), not re-run here
- [ ] Both mobile apps (worker-app, checker-app) — not tested this pass; this scenario covers
      web only. The gap note that authored this file originally flagged mobile as untested too
- [ ] `LanguageSwitcher` UI component itself (the user-facing control, as opposed to the API
      call it makes) — not driven through the browser this pass; `PUT /auth/profile` was called
      directly

## Governing decisions

- No formal specification exists for this feature (confirmed by the original 2026-08-22 gap
  note) — `lib/locales.ts`'s own comments are the closest thing to one, and are treated as
  authoritative here
- `ADR-068` — `uk` added to consent's own language set so the UI/consent locale lists could
  stay in the subset relationship this file's own header describes
- `preferred-language.test.ts` — the existing unit test enforcing `UI_LOCALES ⊆`
  `SUPPORTED_LANGUAGES`
