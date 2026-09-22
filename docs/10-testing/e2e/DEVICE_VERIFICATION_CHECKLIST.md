# Device verification — what a green suite does not prove

The manager app's automated suite is large and says nothing about the items
below. Each one needs a **real phone**, and several need a real phone plus
configuration that does not exist in any test environment.

This list exists because the alternative is discovering them in production.
It is deliberately separate from `scenarios/`: those are executable
procedures, this is an inventory of what no procedure here can execute yet.

**Keep adding to it as work lands.** An item leaves this file only when a
numbered scenario covers it *and* a run log records it passing on a device.

---

## Why these cannot be automated here

| Reason | Items |
|---|---|
| Gesture behaviour has no test renderer | drag-to-move |
| Multipart bodies need a real file provider | every upload |
| Requires credentials the repo cannot hold | push delivery |
| Requires OS permission dialogs | camera, microphone, location |
| Requires the platform's own text engine | RTL, font scaling |
| Requires a real network stack | offline, flaky connection |

---

## 1. Gestures

- [ ] **Long-press drag moves a placement** (Rota). Hold ~400ms, drag onto
      another day in the strip, release. Verify the move by reading
      `CalendarEntry.day` in Postgres — not by the toast.
- [ ] **A normal vertical swipe scrolls the agenda** rather than picking a
      shift up. `activateAfterLongPress(400)` exists for this; if the pan
      activates immediately the list feels broken.
- [ ] **Android specifically.** `GestureHandlerRootView` was mounted nowhere
      in this repository until 2026-09-22; without it the pan handler receives
      no touches on Android and the long press does *nothing*. Nothing warns.
- [ ] **Haptic fires on lift.** `expo-haptics` was not installed at all until
      the same date.
- [ ] **A drop off the strip, or on the origin day, sends no request.**
      Watch the network, not the UI.
- [ ] **The row springs home on failure** and the shift does not appear on a
      day it was never written to.

## 2. Accessibility

- [ ] **VoiceOver (iOS) and TalkBack (Android): the Move action works.** A
      drag is completely inoperable with a screen reader — there is no gesture
      for "pick up and move to the 24th". The `accessibilityAction` is the
      only path for those users, and it has never been exercised.
- [ ] Every screen's rows announce something other than a cuid.
- [ ] 48pt touch targets hold under the platform's larger font sizes.

## 3. File upload (multipart)

Every one of these sends `FormData`. The shared client omits `Content-Type`
so the runtime sets its own boundary — checker-app's copy hardcodes
`application/json` and would break all of them, which is why `mobile/shared`
took worker-app's `request()`.

- [ ] **Photo on account creation** (Team → New). The only multipart path in
      the creation forms.
- [ ] **Document upload**, from camera and from the library.
- [ ] **Signed contract scan** (Team → member → Contract). The phone is the
      scanner here; the web flow assumes a printer and a flatbed.
- [ ] **A file larger than the limit is refused with a readable message**, not
      a generic failure. Note: nginx caps bodies at 64M on the host and
      returned a bare 413 for months — see the 2026-09-21 run log.
- [ ] **Upload over a slow connection** does not appear to hang silently.

## 3b. Export and share sheet

- [ ] **Team report export** and **own-data export** (Settings) download and
      open the system share sheet, with a real file attached.
- [ ] A report with **zero rows** says so rather than sharing an empty file.
- [ ] **On a build made before `expo-sharing` was added**, the download still
      succeeds and only the sharing step is skipped — the modules are required
      lazily precisely so a missing native half does not take down the screen.

## 4. Push notifications

**Blocked** until `com.fhmhotelservices.managerapp` is registered in Apple
Developer with push enabled, `APNS_BUNDLE_ID_MANAGER` is set in the EC2
`.env`, and `google-services.json` for that package exists in
`mobile/manager-app/`.

- [ ] Token registers with `app: 'MANAGER'` — read `PushToken` in Postgres.
- [ ] It registers **after** the consent gate. Registering before returns 403
      `CONSENT_REQUIRED` and the token is then absent for the whole session.
- [ ] A real APNs/FCM send arrives. **A `DELIVERED` outbox row is not
      evidence** — scenario 16's rule applies verbatim.
- [ ] No `DeviceTokenNotForTopic`: that means the manager token was sent to
      another app's topic, the exact outage `PushApp` exists to prevent.
- [ ] **Tapping a notification deep-links to the right screen, for each
      manager type.** This file arrived as a copy of worker-app's and pointed
      at `/offer/:id`, `/rework/:id` and `/shift/:id` — none of which exist
      here, so every tap went nowhere. `push-routes.test.ts` now pins the
      destinations, but only a device proves the payload carries the ids the
      routes need.
- [ ] Token ownership reassigns when a second user signs in on one device.

## 4b. Running an OLD build

The failure mode that no CI run can reproduce: a development build cut
*before* a native dependency was added does not contain it.

- [ ] **Install a build older than the current dependency list and open every
      screen.** Nothing may fail to render. Dictation, haptics, downloads and
      sharing each degrade to absent; none of them may take a screen down.
- [ ] Specifically: Rota (haptics), Assistant (speech), Settings → Export and
      Contract (file system + sharing).

## 5. Permissions

- [ ] **Camera** prompt appears with the app's own wording, not a bare system
      string.
- [ ] **Microphone + speech recognition** for Zelle's voice input. The usage
      strings were added 2026-09-22; nobody has seen the dialog.
- [ ] Denying each permission leaves a usable screen rather than a dead end.

## 6. Zelle (the assistant)

- [ ] **Renders nothing when `FEATURE_CHATBOT` is off.** `isAvailable()`
      swallows its errors deliberately — a 404 (flag off) and a 403 (not
      permitted) must both show no assistant, never an error.
- [ ] With the flag on: a manager-facing tool round-trips.
- [ ] Voice input produces text.

## 7. Layout and i18n

- [ ] **Every screen at 375pt with the page width measured**, not eyeballed.
      A row that cannot shrink pushes the layout past the viewport and
      anything pinned right lands off-screen.
- [ ] **`ar` and `ur` render right-to-left**, including the back arrow.
- [ ] **No raw locale keys anywhere.** i18next renders a missing key as the
      key itself; `translation-keys.test.ts` covers the statically analysable
      ones, but template-literal keys are only partly pinned.
- [ ] Dark mode with no white flash at launch.

## 8. Connectivity

- [ ] **Airplane mode on every screen**: a readable error, never a blank page
      and never a spinner that never ends.
- [ ] A write attempted offline **fails visibly** and is not silently dropped.
- [ ] Pull-to-refresh recovers on reconnect.
- [ ] **Recurring placement mid-run** on a flaky connection: partial results
      are reported as partial. 19 of 26 must never read as success.

## 9. Environment-dependent, not device-dependent

Recorded here because they are the other reason a green suite proves nothing:

- [ ] **`FEATURE_JOBDISPATCH_PHASE2`**: with it off, every placement route
      **404s rather than 403s**, so "not built" is indistinguishable from "not
      permitted". Half the Rota screen cannot be exercised at all. Record the
      flag state before testing.
- [ ] **`FEATURE_GD02_MATRIX`**: decides whether a manager can create a hotel,
      and produces the RM asymmetry recorded as `SIR-CRM-020`.
- [ ] **`FEATURE_CHATBOT`**: default off.
- [ ] **EAS**: `eas init` has run (project `1f4e0ba5…`), but no build has been
      produced and no OTA update published.
