import { existsSync, readFileSync } from 'node:fs';

// Guards the Android FCM build wiring.
//
// Android push needs google-services.json INSIDE the build. Expo only puts it
// there when `expo.android.googleServicesFile` names it — per
// @expo/config-types, "Including this key automatically enables FCM in your
// standalone app". The file sat in this folder untracked and unreferenced for
// a while, so every Android build shipped without Firebase and
// `getDevicePushTokenAsync()` could never return an FCM token.
//
// Nothing surfaced that failure: registerForPushNotificationsAsync swallows it
// by design (push is an enhancement, not a precondition), the device simply
// never registered, and the backend then found no devices for the user and
// marked the outbox event DELIVERED — "nothing to send" is indistinguishable
// from "sent" at the event level. Zero PushToken rows had ever been written.
//
// Asserted against app.json rather than a built artifact because that is the
// single input the build reads, and a config regression is silent everywhere
// else.
describe('Android FCM configuration (worker-app)', () => {
  const app = JSON.parse(readFileSync('app.json', 'utf8')).expo;

  it('declares android.googleServicesFile', () => {
    expect(app.android.googleServicesFile).toBe('./google-services.json');
  });

  it('the referenced google-services.json exists and is committed', () => {
    // A path that resolves to nothing fails the Android build outright, which
    // is the good case; the bad case is this key being dropped entirely.
    expect(existsSync(app.android.googleServicesFile)).toBe(true);
  });

  it('google-services.json belongs to the Firebase project the backend uses', () => {
    // FCM registration tokens are scoped to the SENDER project. A config
    // downloaded from a different Firebase project builds and runs fine, mints
    // tokens happily, and then every send fails with SENDER_ID_MISMATCH (403)
    // — which push-provider.ts does not classify as UNREGISTERED, so the token
    // is never pruned and each notification instead retries on backoff to
    // DEAD_LETTER. Nothing about that points at the config.
    //
    // This exact mismatch nearly shipped: the backend was briefly pointed at
    // a second Firebase project (hotel-crm-b0a24) while these configs were for
    // fhm-hotelservice. Pinned here so the two can never silently disagree. If
    // the project legitimately changes, update this line, .firebaserc, and the
    // backend's FIREBASE_PROJECT_ID + service-account key together.
    const services = JSON.parse(readFileSync('google-services.json', 'utf8'));
    expect(services.project_info.project_id).toBe('fhm-hotelservice');
  });

  it('google-services.json contains a client for this app’s applicationId', () => {
    // Firebase matches a client by package_name at build time. A config
    // downloaded for the other app would build fine and then fail to produce
    // a token at runtime.
    const services = JSON.parse(readFileSync('google-services.json', 'utf8'));
    const packages = services.client.map(
      (c: { client_info: { android_client_info: { package_name: string } } }) =>
        c.client_info.android_client_info.package_name
    );
    expect(packages).toContain(app.android.package);
    expect(app.android.package).toBe('com.fhmhotelservices.workerapp');
  });

  it('registers device tokens under the WORKER app', () => {
    // The backend picks the APNs topic from this value and cannot recover from
    // a wrong one; keeping it beside the applicationId assertion above means a
    // copy-paste between the two apps fails here.
    const config = readFileSync('src/constants/app-config.ts', 'utf8');
    expect(config).toContain("PushApp = 'WORKER'");
  });

  it('no two clients share a Firebase app id', () => {
    // Added 2026-09-23, after the defect this whole file failed to catch.
    //
    // The assertions above check the file against ITSELF, which is exactly
    // what a hand-edit preserves. On 2026-09-23 the Firebase project was
    // found holding this app under `com.hotelcrm.workerapp` while this
    // config claimed `com.fhmhotelservices.workerapp` — commit `3e425c0e`
    // had edited the package names in the JSON instead of re-registering the
    // apps. Every assertion above still passed, and not one Android device
    // had ever registered a token.
    //
    // A duplicated `mobilesdk_app_id` is the fingerprint of that edit: two
    // package names pointing at one registration. It cannot prove the file
    // matches Firebase — only a call to Firebase can — but it catches the
    // specific way this file gets corrupted by hand.
    const services = JSON.parse(readFileSync('google-services.json', 'utf8'));
    const ids = services.client.map(
      (c: { client_info: { mobilesdk_app_id: string } }) => c.client_info.mobilesdk_app_id
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is the same project-level file the other apps ship', () => {
    // Firebase generates ONE config per project listing every client, so all
    // three apps must ship byte-identical files. Divergence means someone
    // edited a copy — the failure mode above — rather than regenerating.
    const mine = readFileSync('google-services.json', 'utf8');
    for (const sibling of ['../checker-app/google-services.json', '../manager-app/google-services.json']) {
      expect(readFileSync(sibling, 'utf8')).toBe(mine);
    }
  });
});
