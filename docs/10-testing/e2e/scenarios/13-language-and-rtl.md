# Scenario 13 — Language Preference, Fallback, and RTL

Verifies the internationalization contract: the persisted preference, the resolution order, the
subset invariant between UI locales and consent-notice languages, and right-to-left rendering.

Covers `SPEC-I18N-001` (`RULE-I18N-01/02/03`, `REQ-I18N-01`) and `ADR-068`.

**Preconditions:** Scenario 00 complete. One non-admin user whose `preferred_language` is still
`NULL` (a freshly-seeded user qualifies — the column has **no default**, deliberately).

> **Why this scenario exists.** Six locales, two of them RTL, shipped across PRs #471–#484 with no
> specification and no test. Four of the six catalogues are machine-translated and have never been
> read by a speaker of the language, so a rendering defect in `ar`, `fr`, `uk` or `ur` has nothing
> standing between it and a user.

---

## Step 0 — `NULL` is a real state, not a missing value

```bash
docker compose exec -T postgres psql -U postgres -d hotel_crm -c \
  "SELECT id, email, preferred_language FROM \"User\" WHERE email = '$WORKER_EMAIL';"
```

**PASS:** `preferred_language` is `NULL` — not `'de'`.

**This is the point of the step.** `NULL` means "never chose"; `'de'` means "explicitly chose
German". A column default would have collapsed the two permanently at backfill, which is why there
isn't one (`REQ-I18N-01`). If you see `de` here on a user who never picked a language, the
distinction has been lost and every downstream "should we ask?" decision is now wrong.

## Step 1 — Persist a preference

```bash
curl -s -X PUT -H "Authorization: Bearer $WT" -H 'Content-Type: application/json' \
  -d '{"preferred_language":"uk"}' http://localhost:3001/api/v1/auth/profile | jq '.data.preferred_language'
curl -s -H "Authorization: Bearer $WT" http://localhost:3001/api/v1/auth/me | jq '.data.preferred_language'
```

**PASS:** both return `"uk"`. **Verify at the data layer too** — re-run Step 0's query and confirm
the column actually changed. A `200` here has meant nothing was written before.

## Step 2 — Reject a language that is not a UI locale

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X PUT -H "Authorization: Bearer $WT" \
  -H 'Content-Type: application/json' -d '{"preferred_language":"ru"}' \
  http://localhost:3001/api/v1/auth/profile
```

**PASS:** `400`. `ru` is in consent's `SUPPORTED_LANGUAGES` (13) but **not** in `UI_LOCALES` (6) —
the app's chrome is not translated into it. Accepting it would leave the user with a preference the
UI cannot honour.

## Step 3 — The subset invariant (`RULE-I18N-01`)

```bash
cd backend && npx jest preferred-language --silent; cd ..
cd frontend && npx jest locales --silent; cd ..
```

**PASS:** both suites green. These enforce that `UI_LOCALES ⊆ SUPPORTED_LANGUAGES` and that the
frontend's hand-maintained mirror of the locale list has not drifted from the backend's.

**This invariant has been violated in production before.** `uk` was a UI locale with no consent
notice, so Ukrainian-speaking workers silently received a **German legal notice** through the
fallback (`SIR-CONSENT-012`, fixed by `ADR-068`). If you add a UI locale, add it to
`SUPPORTED_LANGUAGES` first.

## Step 4 — The consent notice follows the selected language (`ADR-068`)

With `preferred_language = 'uk'` from Step 1:

```bash
curl -s -H "Authorization: Bearer $WT" \
  "http://localhost:3001/api/v1/consent/status?consent_instance=daily-access-gate" | jq '.data'
curl -s -X POST -H "Authorization: Bearer $WT" -H 'Content-Type: application/json' \
  -d '{"consent_instance":"daily-access-gate"}' http://localhost:3001/api/v1/consent/request | jq '.data.language, .data.notice_text' | head -5
```

**PASS:** the notice is served in Ukrainian, **not** German.

**FAIL — and this is the specific regression to watch for:** notice text in German while
`preferred_language` is `uk`. That is `SIR-CONSENT-012` returning, and it is a **GDPR problem**, not
a cosmetic one — a legal notice must be comprehensible to the person consenting.

## Step 5 — Missing keys fall back to German, never to a raw key (`RULE-I18N-03`)

```bash
node -e '
const en=require("./frontend/lib/i18n/locales/en.json");
const count=o=>Object.values(o).reduce((n,v)=>n+(typeof v==="object"?count(v):1),0);
for (const l of ["de","ar","fr","uk","ur"]) {
  const c=require(`./frontend/lib/i18n/locales/${l}.json`);
  console.log(l, count(c), "keys vs en", count(en));
}'
```

**PASS:** key counts are within one or two of `en` (the `_meta` block accounts for small differences).

Then, in the browser at a locale with a deliberately-removed key, confirm the UI shows **German
text**, not a raw key like `nav.dashboard`. A raw key on screen means `fallbackLng` is not resolving.

## Step 6 — RTL actually flips the document

Sign in through the browser with `preferred_language` set to `ar`, then `ur`:

```js
// devtools console
document.documentElement.getAttribute("dir")   // expect "rtl"
document.documentElement.getAttribute("lang")  // expect "ar" or "ur"
```

**PASS:** `dir="rtl"` after hydration, and the layout is genuinely mirrored — sidebar on the right,
text right-aligned, directional arrows pointing the correct way.

**Do not fail this on the server-rendered HTML.** `app/layout.tsx` ships `lang="de" dir="ltr"` as a
deliberate **pre-hydration placeholder**; `LocaleProvider` rewrites both client-side once the stored
preference resolves. Check after hydration, not in view-source.

**Known untested:** RTL on the two mobile apps has never been verified on a device
(`SPEC-MOBILE-001` `OD-MOB-04`). If you have a device, check it and record the result here.

## Step 7 — Resolution order for a user with no stored preference

With a `NULL`-preference user, load the web app in a browser whose `navigator.languages` starts with
`fr-CA`.

**PASS:** the UI renders in **French**. The region subtag is dropped — the UI is translated per
language, not per region (`RULE-I18N-02`). With an unmatched browser language (say `ja`), it renders
in **German**, the platform default.

---

## What this scenario does not cover

- Whether backend-generated strings — notification bodies, emails — honour `preferred_language` at
  all. Recorded as `OD-I18N-06`, **not assessed**. Worth checking the moment someone claims they do.
- Catalogue *content* drift between the three clients. Only the locale *list* is guarded
  (`OD-I18N-02`); three copies of ~847 keys can diverge silently.
- Translation *quality* in the four unreviewed catalogues. No automated check can substitute for a
  speaker reading them (`OD-I18N-01`).
