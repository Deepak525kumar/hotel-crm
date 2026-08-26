# Run log — 2026-08-26 — Worker app native document upload

**Scope:** Scenario 04, client half only (the new Step 6b). The S3/bucket steps were not
re-run — no AWS credentials in this environment, and nothing in this change touches the server.

**Reported symptom:** "not able to upload any documents that user is trying to upload. gives the
error upload failed please try again", under Metro. Then, after a first attempt at a fix,
`upload failed . unsupported formdatapart implementation`.

## What was actually wrong

Not React Native's `FormData`. `node_modules/react-native/Libraries/Network/FormData.js`
`getParts()` accepts any object and does not throw that error at all.

`grep -rl "Unsupported FormDataPart" node_modules/` returns exactly one file:
`node_modules/expo/src/winter/fetch/convertFormData.ts`. Its converter accepts a part only if it
is a string, a `Blob`, or an object with `bytes()`, and `expo/src/winter/runtime.native.ts:52`
(`install('fetch', () => require('./fetch').fetch)`) is what puts that converter on the global
`fetch` on native. The web client was never affected because a browser sends a real `File`.

So the `{uri, name, type}` part shape every RN guide shows is the one shape this stack rejects.

**Fix:** append an `expo-file-system` `File` (`extends ExpoFileSystem.FileSystemFile implements
Blob`, exposes `bytes()` and `name`), lazily required. PR #569.

## Two false starts, recorded so they are not repeated

1. **A truthiness check on `asset.file`.** `expo-document-picker` can hand back a non-`Blob`
   `file` on native; appending it broke every native upload. The guard must be `instanceof Blob`.
2. **`validatePickedAsset({ size })` in the photo path** always returned `unsupportedType`,
   because the camera asset has no filename to derive a type from. Split out `validateFileSize`.

Both were mine, both shipped, and both presented as the same generic "upload failed" string —
which is the argument for the assertion added below.

## Test-suite changes made in the same pass

- `src/__mocks__/expo-file-system.ts` + a `moduleNameMapper` entry in the `unit` jest project.
  The real module throws `__DEV__ is not defined` under a node environment, so it can never be
  required there. **Per-file `jest.mock` does not work for this**: with two suites mocking it,
  whichever ran second failed. That cost a cycle; do not retry it.
- `api.test.ts` installs an RN-faithful `FormData`. The jest project's spec-compliant one
  rejects a non-`Blob` part — i.e. it rejects the part that is *correct* on device.
- Two existing cases asserted the `{uri, name, type}` contract and so locked the bug in. They
  are retargeted, with the reasoning inline. `document-upload-formdata.test.ts` now asserts the
  body's actual contents, which nothing did before — which is how two broken part shapes shipped
  in a row.

**Result:** 338 tests / 38 suites pass, stable over three consecutive full runs. `tsc` clean,
`eslint` 0 errors.

## Not verified — gap, not a pass

No upload was performed from a device or simulator against a live backend, and no S3 object or
`Document` row was read for this run. This environment has neither a device nor AWS credentials.
The fix is established by reading the installed Expo sources and by test only. **Step 6b is
still owed a real run**, and the residual risk is concentrated in `new File(asset.uri)` against
an actual picker URI (content:// on Android, file:// on iOS).
