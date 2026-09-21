# iOS distribution: moving the two apps to the App Store

## Why this changed

Until now both apps reached iPhones as **ad-hoc** builds served by `daiwi/`
(`distribution: "internal"` in `eas.json`). An ad-hoc provisioning profile
embeds a fixed list of device UDIDs **at signing time**. A phone that is not on
that list cannot install the build, and iOS says so in a way that reads like a
corrupted download:

> „Hotel CRM Checker" kann nicht installiert werden — Diese App kann nicht
> installiert werden, da ihre Integrität nicht verifiziert werden konnte.

That message is iOS rejecting the *code signature*, not a failed download. It
was reported from a real phone on 2026-09-21 while the manifest, the HTTPS
serving and the S3 stream were all working correctly — the greyed placeholder
icon on the home screen proves `installd` had already fetched the IPA. Anyone
debugging nginx, the manifest or the download route for this symptom is
looking in the wrong place.

Registering the device afterwards does **not** fix an IPA that already exists;
the UDID list is inside the signature. Every new phone needs a fresh build or
an `eas build:resign`. On top of that, Apple caps ad-hoc at **100 iPhones per
membership year**, and disabling a device does not free its slot until renewal.
So the ad-hoc channel was always going to end; the only question was when.

**Unlisted App Distribution** removes the failure mode entirely: the app is on
the App Store but not searchable, not in categories, charts or recommendations,
and installs only from a direct link. Any iPhone, any Apple Account, no UDIDs,
no device cap, no expiry. Apple names this use case explicitly — "employee
resources" and "apps for limited audiences" are listed as good candidates.

The cost is App Review on every binary, typically 1–2 days. That is why
`expo-updates` was added in the same change (see below): it buys back instant
shipping for everything that is not a native change.

## What is already done in the repository

Both `mobile/worker-app` and `mobile/checker-app` received the same three
changes. They are inert until you complete the Apple-side steps below.

1. **`expo-updates` installed** (`~57.0.23`). It was never installed, even
   though `app.json` already set `runtimeVersion` and `package.json` already
   had an `eas:update` script — both were dead configuration pointing at a
   package that was not there.
2. **`app.json` → `updates.url`** pointing at each app's EAS project, with
   `fallbackToCacheTimeout: 0` so a slow hotel Wi-Fi never delays app start.
   An update downloaded on one launch is applied on the next.
3. **`app.json` → `ITSAppUsesNonExemptEncryption: false`.** Both apps use only
   HTTPS and the OS keychain (`expo-secure-store`), which is exempt. Without
   this declaration App Store Connect asks the export-compliance question on
   every single upload. **Confirm this is still true before each submission** —
   it is a legal declaration, not a build setting.
4. **`eas.json` → a `channel` on every build profile** (`development`,
   `preview`, `production`), so an update published to a channel reaches only
   the builds made from that profile.

`runtimeVersion` stays on the `appVersion` policy, which is the safe pairing:
an OTA update only reaches binaries with the same `version`. Bump `version` in
`app.json` and you have declared that a new binary is required — old installs
will correctly ignore the update rather than load JS their native side cannot
serve.

The `ios/` and `android/` directories are prebuild output and are **not**
tracked by git, so EAS Build regenerates them. Local copies are now stale; run
`npx expo prebuild --clean` before `expo run:ios` on this machine.

## What has to be done by hand, per app

Do the **checker app first**. It has the smaller audience and it is the one
currently failing, so the blast radius of a mistake is smallest.

### 0. Before either app — the demo account

App Review requires working credentials and sample data; a reviewer must be
able to sign in and operate the app. Production at `deepcleaninghub.de` holds
real workers, real shifts and real payroll, and a reviewer must not be inside
it. Seed a demo tenant with fake hotels, fake rooms and fake shifts, and a
login that stays alive — Apple re-uses it on every future submission, so a
throwaway account will block a release months from now.

This is the only step with real engineering work in it. Everything below is
form-filling.

### 1. Create the app record

App Store Connect → **Apps** → **+** → New App.

- Platform: iOS
- Bundle ID: `com.fhmhotelservices.checkerapp` (worker:
  `com.fhmhotelservices.workerapp`)
- Distribution: **Public** — counter-intuitive, but unlisted is a conversion
  applied to an approved public app, not a choice at creation. Private/custom
  distribution is a different route and **cannot be changed later** without a
  new app record.

### 2. Fill the metadata and the privacy questionnaire

Description, screenshots, support URL, and App Privacy (what the app collects:
location during check-in, photos as evidence, name and contact details). The
privacy answers are separate from the `PrivacyInfo.xcprivacy` that Expo
generates during prebuild — Expo covers required-reason APIs, not disclosure.

### 3. Build and upload

```bash
cd mobile/checker-app
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production
```

After the app record exists, fill `submit.production.ios` in `eas.json` with
`appleId`, `ascAppId` and `appleTeamId` so later submissions are
non-interactive. It is deliberately left empty until those values exist.

### 4. Ask for unlisted distribution

- In the submission's **Review Notes**, state that this is an internal app for
  company staff and that you are requesting unlisted distribution. This is what
  prevents a Guideline 3.2 (Business) rejection for an org-specific app.
- Include the demo credentials in the same notes.
- Submit for review.
- File the request at
  <https://developer.apple.com/contact/request/unlisted-app/>. Apple declines
  requests for apps that have not been submitted to review, or that are in a
  beta state, so the order matters.

### 5. Cut over the phones

The App Store build is signed with a different profile from the daiwi ad-hoc
build carrying the same bundle ID, so **iOS will not upgrade over it**. Every
person must:

1. Delete the existing app (long-press → delete).
2. Open the App Store link.
3. Sign in again — `expo-secure-store` data goes with the deleted app.

Announce this. A housekeeper who finds themselves logged out mid-shift with no
warning will call someone.

### 6. Repeat for the worker app

Same steps, once the checker cutover has actually worked on real phones.

## Day to day, afterwards

**Changed only JS, styles, strings or assets?** Ship it in minutes, no review:

```bash
cd mobile/worker-app
npx eas-cli update --branch production --message "what changed"
```

**Changed anything native** — a new Expo module, a permission string, an
`app.json` plugin, the app `version` — then it needs a new binary and a new
review. If a change requires `expo prebuild` to take effect, OTA cannot ship it.

Apple permits this under Guideline 2.5.2's interpreted-code clause: React
Native JavaScript only calls native code that was already audited at
submission. Do not use it to change what the app fundamentally does — that is
the line the clause draws.

## What daiwi still does

`daiwi/` does not go away. It keeps:

- **Android.** APKs install directly with no signature gate of this kind.
- **Development and QA builds** on the `preview` profile, still ad-hoc, still
  needing `eas device:create` for each test device. That is fine for a handful
  of staff phones, and it is what ad-hoc is actually for.
- **`ReleaseHistory`**, the append-only record of every version ever published.

What it stops being is the production iOS channel.

One known wording bug remains in `daiwi/src/views/install.ejs`: the note under
"Provisioned devices" tells the operator that an unregistered device fails
"with no error message from iOS". It does not — it shows the integrity alert
quoted at the top of this document. Left for a separate change so this one
stays reviewable.
