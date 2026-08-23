# Internationalization — cross-cutting architecture specification

## Document Control

| Field | Value |
|---|---|
| Spec ID / version | `SPEC-I18N-001 / 0.1.0` |
| Status | `REVIEW` — **not frozen.** Authored after implementation, describing as-built behaviour. No G4 independent-review round and no G2 Specification Freeze has been run. |
| Type | **Cross-cutting architecture**, not a module specification. Internationalization is owned by no single module: it spans the web app, both mobile apps, and one column on `User`. It is filed here rather than under `docs/03-modules/` for that reason. |
| Owner | `unassigned` — reserved human authority (`SYNC-001`). |
| Repository revision | Reverse-specified at `8626256` (2026-08-23). |
| Approved by / at | — (G2 requires a named human approver; not sought) |
| Supersedes | None. First specification for this capability. |
| Why it exists | The capability shipped across PRs #471–#484 (2026-08-16..18) with **no documentation anywhere** — no module spec, no ADR, no entry in any knowledge index. `ADR-068` settles one narrow slice (the consent notice language) and was the only governing record. A conversational interface cannot be specified without stating which language it answers in, so this became a prerequisite for the chatbot work. |

---

## 1. The two language contracts

The single most important thing in this document: **there are two different language lists, and
they answer different questions.** Conflating them has already produced one defect
(`SIR-CONSENT-012`).

| | `UI_LOCALES` | `SUPPORTED_LANGUAGES` |
|---|---|---|
| Question answered | What languages is the **application's own chrome** translated into? | What languages does **legal notice content** exist in? |
| Values | `de`, `en`, `ur`, `ar`, `fr`, `uk` (6) | `de`, `en`, `ur`, `ar`, `ru`, `it`, `pl`, `tr`, `fr`, `es`, `da`, `hsb`, `uk` (13) |
| Source of truth | `backend/src/lib/locales.ts` | `backend/src/modules/consent/types.ts` |
| Governing authority | Owner decision, 2026-08-16 | `SPEC-CONSENT-001`, CRR §32, as amended by `ADR-068` |

### RULE-I18N-01 — the subset invariant

`UI_LOCALES` **MUST** remain a subset of `SUPPORTED_LANGUAGES`, so a worker always receives the
consent notice in the language they selected.

The reverse does not hold, and deliberately so: a language can be legally noticed without being
UI-translated (`ru`, `it`, `pl`, `tr`, `es`, `da`, `hsb` are today). **Adding a UI locale therefore
means adding it to `SUPPORTED_LANGUAGES` first.**

This invariant was violated once — `uk` was a UI locale with no consent notice, so Ukrainian-speaking
workers silently received a German legal notice via the `DEFAULT_LANGUAGE` fallback. `ADR-068`
resolved it by adding `uk` to the consent contract (`SIR-CONSENT-012`).
Enforced by `backend/src/__tests__/preferred-language.test.ts`.

---

## 2. Persistence and resolution

### REQ-I18N-01 — the preference is nullable on purpose

`User.preferred_language` is `String?` (`backend/prisma/schema.prisma:379`). **Null is meaningful**:
it distinguishes *"this user has never chosen"* from *"this user explicitly chose German."* A column
default would collapse those two states permanently at backfill, so there is none.

### RULE-I18N-02 — resolution order

1. **Stored preference** (`User.preferred_language`), when non-null.
2. **Negotiated from the client**, when the preference is null — `navigator.languages` for web,
   device locale for mobile. Region subtags are dropped (`fr-CA` → `fr`): the UI is translated per
   *language*, not per region.
3. **`DEFAULT_UI_LOCALE` = `de`** when nothing negotiates.

First paint cannot know the stored preference — auth resolves asynchronously via `GET /auth/me` —
so the client renders the negotiated locale immediately and reconciles to the stored preference when
it arrives. This avoids flashing German at a French user for a network round-trip.

### RULE-I18N-03 — missing keys fall back to German, never to a raw key

`fallbackLng` is `de` for every locale. A user of a partially-translated catalogue sees German, not
`nav.dashboard`. This makes the German catalogue load-bearing for *every* locale: an error in `de`
surfaces in all six.

---

## 3. Right-to-left

`RTL_UI_LOCALES` = `ur`, `ar`. `dirFor(locale)` returns `'rtl' | 'ltr'`.

`frontend/app/layout.tsx` hardcodes `lang="de" dir="ltr"` — this is a **pre-hydration placeholder,
not a defect**. The real values depend on the signed-in user's stored preference, which is unknown
server-side, so `LocaleProvider` rewrites both on the client. German is chosen for the placeholder
because it is the platform default and therefore the likeliest correct pre-hydration value.

---

## 4. Catalogue status — four of six are unreviewed

**This is the most important caveat in this document.** Per each catalogue's own `_meta.reviewed`:

| Locale | Reviewed | Note |
|---|---|---|
| `en` | ✅ | **Source catalogue.** Keys are authored here first; every other locale mirrors its key set. |
| `de` | ✅ | Primary-market language *and* the fallback every other locale resolves to. |
| `ar` | ❌ | Machine-translated, not reviewed by a human speaker. AI review pass 2026-08-16. |
| `fr` | ❌ | as above |
| `uk` | ❌ | as above |
| `ur` | ❌ | as above |

Roughly 847 keys per catalogue. `_meta` is stripped before the catalogue reaches i18next
(`frontend/lib/i18n/index.ts`) — `ignoreJSONStructure` does **not** hide it, so a mistyped key could
otherwise render the "MACHINE-TRANSLATED" warning into the UI.

**OD-I18N-01 (open).** Four catalogues serving a German-market workforce platform have never been
read by a speaker of the language. For a workforce app whose users are frequently non-German
speakers, this is a product risk, not merely a polish item. Human review is not scheduled.

---

## 5. Client parity

Three clients each carry their own copy of the six catalogues:
`frontend/lib/i18n/locales/`, `mobile/worker-app/src/lib/i18n/locales/`,
`mobile/checker-app/src/lib/i18n/locales/`.

`frontend/lib/locales.ts` is a **hand-maintained mirror** of `backend/src/lib/locales.ts` — the
frontend has no build-time dependency on the backend package. Drift is caught by
`frontend/__tests__/locales.test.ts`, which fails loudly if the two lists diverge.

**OD-I18N-02 (open).** Catalogue *content* has no equivalent cross-client drift guard — only the
locale *list* is checked. Three copies of ~847 keys can diverge silently.

### Language picker

Locale labels are **endonyms** — each language named in itself (`Deutsch`, `English`, `اردو`,
`العربية`, `Français`, `Українська`). Someone who reads only Arabic cannot find their language in a
list that calls it "Arabic". **Never translate these.**

---

## 6. What this means for the Chatbot

Recorded because `SPEC-CHATBOT-001` cannot be completed without it, and **not resolved here**:

- **OD-I18N-03.** Which language does the chatbot answer in? `User.preferred_language` is the
  obvious source, but it is null for users who never chose, and it governs *UI chrome* — not
  free-text generation. Whether an LLM response follows the UI locale, the language the user typed
  in, or an explicit per-conversation setting is undecided.
- **OD-I18N-04.** All six UI locales are in scope for a chatbot, including two RTL. Neither the
  conversation transport nor any rendering surface has been assessed for RTL.
- **OD-I18N-05.** `UI_LOCALES` (6) and `SUPPORTED_LANGUAGES` (13) differ. If the chatbot ever
  delivers or explains legal notice content, which list bounds it is undecided.
- The `de` fallback means a chatbot inheriting UI-locale semantics would answer a Ukrainian speaker
  in German whenever a string is missing. Acceptable for chrome; likely **not** acceptable for
  generated conversation.

---

## 7. Open decisions

| ID | Decision | Status |
|---|---|---|
| `OD-I18N-01` | Human review of the four machine-translated catalogues | **OPEN** — not scheduled |
| `OD-I18N-02` | Cross-client catalogue *content* drift guard | **OPEN** |
| `OD-I18N-03` | Which language the chatbot answers in | **OPEN** — blocks `SPEC-CHATBOT-001` |
| `OD-I18N-04` | RTL support in conversational surfaces | **OPEN** |
| `OD-I18N-05` | Which language list bounds chatbot-delivered notice content | **OPEN** |
| `OD-I18N-06` | Whether backend-generated strings (notifications, emails) honour `preferred_language` | **OPEN** — not assessed in this pass |

## 8. Evidence

| Claim | Source |
|---|---|
| `UI_LOCALES`, `RTL_UI_LOCALES`, `DEFAULT_UI_LOCALE`, `LOCALE_LABELS`, `negotiateLocale`, `dirFor` | `backend/src/lib/locales.ts`; mirrored in `frontend/lib/locales.ts` |
| `SUPPORTED_LANGUAGES` (13), `DEFAULT_LANGUAGE` | `backend/src/modules/consent/types.ts:29-53` |
| Nullable preference and its rationale | `backend/prisma/schema.prisma:377-379`; migration `20260816000000_user_preferred_language` |
| Fallback and `_meta` stripping | `frontend/lib/i18n/index.ts` |
| Subset invariant enforcement | `backend/src/__tests__/preferred-language.test.ts` |
| Locale-list drift guard | `frontend/__tests__/locales.test.ts` |
| Pre-hydration `lang`/`dir` placeholder | `frontend/app/layout.tsx:30-37` |
| Catalogue review status | `_meta.reviewed` in each `locales/*.json` |
| Ukrainian notice gap and its resolution | `ADR-068`, `SIR-CONSENT-012` |
