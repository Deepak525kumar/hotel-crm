# mobile/shared

Design system, API client, stores and locale catalogues for `mobile/manager-app`.

**Read `MIGRATION.md` before changing anything here.** Most files in this
package are verbatim copies of `worker-app`'s, and both shipped apps still
carry their own. A fix here is usually a fix owed in two other places; that
file lists exactly which.

## Gates

```bash
npm run typecheck
```

There is no jest project in this package. Its behaviour is covered by
`manager-app`'s suite, which imports these modules directly — including the
locale lockstep, which deep-equals these catalogues against the frontend's.
That is deliberate: a second jest/babel/jest-expo setup for a library with no
screens would be configuration to maintain for no additional coverage.

## The things that will cost you time

- **Locale keys are all-or-nothing.** Four catalogues (frontend, worker,
  checker, here) are pinned to each other. Adding a key to one fails CI in
  packages your branch never opened. Never add a dead key just to pass.
- **No screen may hardcode a colour.** `theme.ts` says this at length and it
  is the rule with the most expensive failure mode: an inline `#FFFFFF` looks
  correct in light mode and renders white-on-white in dark, invisible to
  typecheck and to every test.
- **`api.ts` must not set `Content-Type` on FormData.** It duck-types the body
  and omits the header so the runtime supplies the multipart boundary. Adding
  the header back breaks every upload, and checker-app's copy has that bug.
- **`title` is 48pt.** Use `h1`/`h2` for manager screens. Changing `title`
  would restyle two production apps.
