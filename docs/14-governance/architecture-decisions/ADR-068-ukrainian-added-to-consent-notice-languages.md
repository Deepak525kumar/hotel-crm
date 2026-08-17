# ADR-068: Ukrainian Added to the Consent Notice Languages — Notice Follows the Selected Language

- **Status:** Accepted — ratified by the commissioning human on 2026-08-18 ("put notice in the
  language selected be it any language"), given in direct response to the escalation that raised
  `SIR-CONSENT-012` as a DPO decision. Authored by the Lead Architect from that instruction.
- **Date:** 2026-08-18
- **Scope:** `SUPPORTED_LANGUAGES` in `backend/src/modules/consent/types.ts`, the constant
  implementing `SPEC-CONSENT-001@0.2.0`'s notice-language list (CRR §32, line 379).
- **Supersedes:** none. **Amends:** `SPEC-CONSENT-001@0.2.0` (FROZEN) and CRR §32 — the notice
  language list goes from 12 entries to 13 by appending `uk` (Ukrainian).
- **Change class:** Amendment to a frozen specification. Per Constitution §6/§7 a frozen
  specification may not be widened by an implementation choice, so this record — and the
  authorization it carries — is the precondition for the code change, not a description of it.

---

## 1. Context

`SIR-CONSENT-012` (raised 2026-08-16 during the i18n stack review) recorded a divergence between
two language lists that answer different questions:

- `UI_LOCALES` (`backend/src/lib/locales.ts`) — the languages the client applications render their
  own chrome in. Owner decision 2026-08-16: `de, en, ur, ar, fr, uk`.
- `SUPPORTED_LANGUAGES` (`backend/src/modules/consent/types.ts`) — the languages GDPR Art. 13
  notice *content* exists in. `SPEC-CONSENT-001@0.2.0`, frozen, from CRR §32: twelve languages,
  carrying `ru` but **no** `uk`.

The consequence: a worker who selected Ukrainian read the entire app in Ukrainian, then received
the data-protection notice in German, via the `DEFAULT_LANGUAGE = 'de'` fallback that
`SIR-CONSENT-009`/`ADR-037` established for exactly the "notice unavailable in this language" case.
That fallback is correct behaviour for its intended case — an unsupported language — but here it
fired for a language the platform had deliberately chosen to ship.

The i18n implementation did **not** widen the frozen list, which was the right call: doing so would
have amended a frozen specification without authority. It documented the divergence in
`lib/locales.ts` and raised the register entry instead.

**Materiality at the time of raising:** `NOTICE_CONTENT` (`modules/consent/service.ts`) is a
per-language structural placeholder generated from `SUPPORTED_LANGUAGES`; no locale, German
included, serves real legal copy. So no Ukrainian worker was receiving German legal text — the gap
was latent. It becomes a live GDPR Art. 12(1) ("clear and plain language") exposure the moment
Zirove/DPO-authored copy replaces the placeholder.

## 2. Decision

**`uk` is added to `SUPPORTED_LANGUAGES`**, making 13 notice languages. A worker receives the
consent notice in the language they selected.

The commissioning human's instruction — "put notice in the language selected be it any language" —
resolves `SIR-CONSENT-012`'s stated either/or (amend the spec, or deliberately serve Ukrainian
workers the default-language notice) in favour of the amendment, and states the general principle
behind it rather than only the `uk` case.

That general principle is encoded as an invariant: **`UI_LOCALES` must remain a subset of
`SUPPORTED_LANGUAGES`.** Shipping a UI locale is now a commitment to notice content in that
locale. `backend/src/__tests__/preferred-language.test.ts` enforces it for every current and future
UI locale, so the next locale added cannot silently reintroduce this gap.

`DEFAULT_LANGUAGE = 'de'` and the fallback branch are unchanged — the fallback remains correct for
a language genuinely outside the list (a client sending `ru`, or a malformed value).

## 3. What this does NOT decide

- **It does not supply Ukrainian legal copy.** `NOTICE_CONTENT['uk']` is the same structural
  placeholder every other language carries, pending Zirove/DPO authorship. This record makes
  Ukrainian a language the system will serve a notice in; it does not make that notice legally
  reviewed. Shipping real copy remains gated on the DPO, for all 13 languages.
- **It does not add `uk` to the UI locale list** — `uk` was already there. The lists move toward
  each other from the consent side only.
- **It does not remove the eight consent-only languages** (`ru`, `it`, `pl`, `tr`, `es`, `da`,
  `hsb`, and the rest not in `UI_LOCALES`). The subset relation is one-directional: legally
  noticeable without being UI-translated stays legitimate.
- **It does not alter RTL handling.** `RTL_LANGUAGES` remains exactly `['ar', 'ur']`; Ukrainian is
  left-to-right.

## 4. Consequences

**Accepted.** A frozen specification is amended, and CRR §32's list no longer matches the
constant without reference to this record. That cost is deliberate: the alternative was a
GDPR-facing behaviour (notice language ≠ selected language) persisting because the document
describing it was frozen. Freezing is meant to prevent unauthorized drift, not to make an
authorized correction impossible.

**Latent, not urgent.** Because every language's notice is still a placeholder, this change alters
no legal text served to any worker today. Its effect is that when real copy ships, Ukrainian is in
scope for translation rather than silently absent.

**New obligation.** Adding a UI locale now also requires adding it to `SUPPORTED_LANGUAGES` and
commissioning notice copy for it. This is a real cost on future locale additions, and is the
intended consequence — the invariant is the point of the decision, not a side effect.

## 5. Implementation

- `backend/src/modules/consent/types.ts` — `'uk'` appended to `SUPPORTED_LANGUAGES`; header comment
  updated to cite this record. `NOTICE_CONTENT` is generated from this constant, so the Ukrainian
  placeholder appears with no further change.
- `backend/src/lib/locales.ts` — the divergence rationale is replaced by the subset invariant and
  a pointer to this record.
- `backend/src/__tests__/consent-validation.test.ts` — the length assertion moves 12 → 13 and adds
  `uk`.
- `backend/src/__tests__/preferred-language.test.ts` — the test that asserted `uk` was *absent*
  from the consent list (written to be updated "as part of that spec amendment — not silently
  deleted") is replaced by the subset invariant over all `UI_LOCALES`.
- `docs/03-modules/consent/MODULE_SPEC.md` — notice-language count corrected, Document Control
  history row appended.
- `.claude/governance/SPECIFICATION_ISSUES_REGISTER.md` — `SIR-CONSENT-012` → RESOLVED.

## 6. Alternatives rejected

- **Serve Ukrainian-preferring workers the German notice, deliberately.** The other branch of
  `SIR-CONSENT-012`. Rejected by the commissioning human. It would also have required defending,
  under GDPR Art. 12(1), why a platform that translated its whole interface into a language
  declined to notice in it.
- **Drop `uk` from `UI_LOCALES` instead**, restoring the subset relation by narrowing the UI side.
  Rejected: it withdraws a shipped translation from workers who use it, to satisfy a list, and
  answers the human's instruction backwards.
- **Leave the divergence and wait for the DPO.** Rejected as the instruction was given. Waiting had
  a real failure mode: the gap is invisible until legal copy ships, which is precisely the moment
  it stops being latent.
