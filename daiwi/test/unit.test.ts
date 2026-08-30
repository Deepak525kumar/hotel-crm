import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { minOsLabel, androidVersionForApiLevel, failureReason } from "../src/routes/builds.js";
import { isChannel, isPlatform, CHANNELS, PLATFORMS } from "../src/lib/domain.js";
import { passwordProblem, hashResetToken, newResetToken, MIN_PASSWORD_LENGTH } from "../src/lib/passwords.js";
import { buildManifest, itmsServicesUrl, inspectUserAgent } from "../src/lib/manifest.js";
import { newKey } from "../src/lib/storage.js";
import { detectIosChannel, detectAndroidChannel } from "../src/lib/detectChannel.js";
import { barChart, toDailySeries } from "../src/lib/sparkline.js";
import { formatSize } from "../src/lib/format.js";
import { appForBundleId, isAppKey, APPS } from "../src/lib/apps.js";

describe("minimum OS labelling", () => {
  test("iOS reports the declared version", () => {
    assert.equal(
      minOsLabel({ platform: "IOS", minOsVersion: "16.0", minOsOverride: null }),
      "iOS 16.0+"
    );
  });

  test("Android translates an API level into the version a user recognises", () => {
    // A worker knows "Android 9", not "minSdkVersion 28".
    assert.equal(
      minOsLabel({ platform: "ANDROID", minOsVersion: "28", minOsOverride: null }),
      "Android 9+"
    );
  });

  test("the operator override wins over what the binary declared", () => {
    assert.equal(
      minOsLabel({ platform: "IOS", minOsVersion: "13.0", minOsOverride: "16.0" }),
      "iOS 16.0+"
    );
  });

  test("no version at all yields no label rather than a broken one", () => {
    assert.equal(minOsLabel({ platform: "IOS", minOsVersion: null, minOsOverride: null }), null);
  });

  test("an Android override is shown verbatim, not read as an API level", () => {
    // An operator typing "14" means Android 14. Translating it as an API level
    // would display "Android 10" — the overlap between the two number ranges is
    // exactly why the override bypasses translation.
    assert.equal(
      minOsLabel({ platform: "ANDROID", minOsVersion: "34", minOsOverride: "14" }),
      "Android 14+"
    );
  });

  test("a parsed API level maps to its version number", () => {
    assert.equal(androidVersionForApiLevel("34"), "14");
    assert.equal(androidVersionForApiLevel("21"), "5.0");
  });

  test("an unmapped API level degrades to a readable string, not a crash", () => {
    assert.equal(androidVersionForApiLevel("99"), "API 99");
    assert.equal(androidVersionForApiLevel("nonsense"), "nonsense");
  });
});

describe("channel and platform guards", () => {
  test("only the known values are accepted", () => {
    for (const c of CHANNELS) assert.ok(isChannel(c));
    for (const p of PLATFORMS) assert.ok(isPlatform(p));
  });

  test("anything else is rejected", () => {
    // These are the shapes a crafted request body actually takes.
    for (const bad of ["", "production", "PROD", null, undefined, 1, {}, ["PRODUCTION"]]) {
      assert.equal(isChannel(bad), false, `isChannel(${JSON.stringify(bad)})`);
      assert.equal(isPlatform(bad), false, `isPlatform(${JSON.stringify(bad)})`);
    }
  });
});

describe("password rules", () => {
  test("a short password is refused", () => {
    assert.match(passwordProblem("a".repeat(MIN_PASSWORD_LENGTH - 1))!, /at least/);
  });

  test("a password at the minimum length is accepted", () => {
    assert.equal(passwordProblem("abcdefghijkl1"), null);
  });

  test("an absurdly long password is refused rather than fed to bcrypt", () => {
    // bcrypt truncates at 72 bytes; a megabyte-long input is a DoS vector.
    assert.match(passwordProblem("a".repeat(201))!, /at most/);
  });

  test("the password may not contain the local part of the email", () => {
    assert.match(passwordProblem("mayank-secret-1", "mayank@example.com")!, /email/);
  });

  test("a single repeated character is refused", () => {
    assert.match(passwordProblem("aaaaaaaaaaaaaa")!, /repeated/);
  });
});

describe("reset tokens", () => {
  test("tokens are long and URL-safe", () => {
    const token = newResetToken();
    assert.ok(token.length >= 43, `token too short: ${token.length}`);
    assert.match(token, /^[A-Za-z0-9_-]+$/);
  });

  test("two tokens never collide", () => {
    const seen = new Set(Array.from({ length: 500 }, () => newResetToken()));
    assert.equal(seen.size, 500);
  });

  test("hashing is deterministic and does not return the token itself", () => {
    const token = newResetToken();
    const hash = hashResetToken(token);
    assert.equal(hash, hashResetToken(token));
    assert.notEqual(hash, token);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });
});

describe("iOS OTA manifest", () => {
  const base = {
    ipaUrl: "https://example.com/install/abc/download",
    bundleId: "app.hotelcrm.worker",
    version: "1.4.2",
    title: "Hotel CRM Worker",
  };

  test("a well-formed manifest names the package and the bundle", () => {
    const xml = buildManifest(base);
    assert.match(xml, /software-package/);
    assert.match(xml, /app\.hotelcrm\.worker/);
    assert.match(xml, /1\.4\.2/);
  });

  test("plain http is refused outright", () => {
    // iOS rejects it silently, so failing loudly here is the only way anyone finds out.
    assert.throws(() => buildManifest({ ...base, ipaUrl: "http://example.com/a.ipa" }), /https/);
  });

  test("an http icon is refused too", () => {
    assert.throws(
      () => buildManifest({ ...base, displayImageUrl: "http://example.com/i.png" }),
      /https/
    );
  });

  test("the manifest URL is percent-encoded in the itms-services link", () => {
    // Unencoded, iOS truncates at the first & and the install silently does nothing.
    const url = itmsServicesUrl("https://example.com/m.plist?t=1&x=2");
    assert.ok(url.includes("https%3A%2F%2Fexample.com%2Fm.plist%3Ft%3D1%26x%3D2"));
  });
});

describe("user-agent detection", () => {
  const IOS_SAFARI =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

  test("iOS Safari can be offered the install button", () => {
    const ua = inspectUserAgent(IOS_SAFARI);
    assert.equal(ua.platform, "ios");
    assert.equal(ua.isSafari, true);
    assert.equal(ua.isInAppBrowser, false);
  });

  test("in-app browsers are detected, since they cannot start the installer", () => {
    // The single largest source of "the link doesn't work" reports.
    for (const app of ["FBAN/FBIOS", "Instagram 300.0", "WhatsApp/2.24", "Slack/23"]) {
      const ua = inspectUserAgent(`${IOS_SAFARI} ${app}`);
      assert.equal(ua.isInAppBrowser, true, app);
      assert.equal(ua.isSafari, false, app);
    }
  });

  test("Chrome on iOS is not treated as Safari", () => {
    assert.equal(inspectUserAgent(`${IOS_SAFARI} CriOS/120`).isSafari, false);
  });

  test("Android is detected", () => {
    assert.equal(inspectUserAgent("Mozilla/5.0 (Linux; Android 14) Chrome/120").platform, "android");
  });

  test("a desktop browser falls through to the QR-code path", () => {
    assert.equal(inspectUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)").platform, "other");
  });
});

describe("storage keys", () => {
  test("a traversal attempt cannot escape the prefix", () => {
    // The separators are what matter: "..", with every slash stripped, is just
    // an ordinary filename character and cannot walk up a directory.
    const key = newKey("builds/abc", "../../etc/passwd");
    assert.equal(key.split("/").length, 3, key);
    assert.ok(key.startsWith("builds/abc/"), key);
    assert.match(key, /^builds\/abc\/\d+-[A-Za-z0-9._-]+$/);
  });

  test("spaces, quotes and semicolons cannot reach a header or a path", () => {
    const key = newKey("builds/abc", 'my app";drop.ipa');
    assert.match(key, /^builds\/abc\/\d+-[A-Za-z0-9._-]+$/);
  });

  test("keys stay under the prefix they were asked for", () => {
    assert.ok(newKey("icons/xyz", "icon.png").startsWith("icons/xyz/"));
  });
});

describe("channel detection — iOS", () => {
  test("a development-signed build is development", () => {
    // get-task-allow is the debugger entitlement; Apple will not sign a
    // distribution build with it, so it settles the question on its own.
    const d = detectIosChannel({ hasProfile: true, profileType: "development", getTaskAllow: true });
    assert.equal(d.channel, "DEVELOPMENT");
    assert.match(d.reason, /get-task-allow/);
  });

  test("get-task-allow outranks a profile that claims to be a release", () => {
    const d = detectIosChannel({ hasProfile: true, profileType: "ad-hoc", getTaskAllow: true });
    assert.equal(d.channel, "DEVELOPMENT");
  });

  test("an ad-hoc release build is production — this is what workers install", () => {
    const d = detectIosChannel({ hasProfile: true, profileType: "ad-hoc", getTaskAllow: false });
    assert.equal(d.channel, "PRODUCTION");
  });

  test("an enterprise in-house build is production", () => {
    assert.equal(
      detectIosChannel({ hasProfile: true, profileType: "enterprise", getTaskAllow: false }).channel,
      "PRODUCTION"
    );
  });

  test("the development APNs environment marks a build as development", () => {
    const d = detectIosChannel({
      hasProfile: true,
      profileType: "ad-hoc",
      getTaskAllow: false,
      apsEnvironment: "development",
    });
    assert.equal(d.channel, "DEVELOPMENT");
  });

  test("an unsigned IPA falls back to development, not production", () => {
    // The fallback direction is the whole point: an unreadable build must not
    // land in the promotable list.
    const d = detectIosChannel({ hasProfile: false });
    assert.equal(d.channel, "DEVELOPMENT");
    assert.match(d.reason, /unsigned|unreadable/i);
  });

  test("an unclassifiable profile falls back to development", () => {
    assert.equal(
      detectIosChannel({ hasProfile: true, profileType: "unknown", getTaskAllow: false }).channel,
      "DEVELOPMENT"
    );
  });
});

describe("channel detection — Android", () => {
  const release = {
    manifestRead: true,
    debuggable: false,
    debugSigned: false,
    hasDevClient: false,
    packageName: "com.fhmhotelservices.workerapp",
    versionName: "1.4.2",
  };

  test("a plain release build is production", () => {
    assert.equal(detectAndroidChannel(release).channel, "PRODUCTION");
  });

  test("android:debuggable makes it development", () => {
    const d = detectAndroidChannel({ ...release, debuggable: true });
    assert.equal(d.channel, "DEVELOPMENT");
    assert.match(d.reason, /debuggable/);
  });

  test("the debug keystore makes it development", () => {
    assert.equal(detectAndroidChannel({ ...release, debugSigned: true }).channel, "DEVELOPMENT");
  });

  test("a bundled Expo dev client makes it development", () => {
    const d = detectAndroidChannel({ ...release, hasDevClient: true });
    assert.equal(d.channel, "DEVELOPMENT");
    assert.match(d.reason, /dev client/i);
  });

  test("a .debug application id makes it development", () => {
    assert.equal(
      detectAndroidChannel({ ...release, packageName: "com.fhmhotelservices.workerapp.debug" }).channel,
      "DEVELOPMENT"
    );
  });

  test("a -dev version name makes it development", () => {
    assert.equal(detectAndroidChannel({ ...release, versionName: "1.4.2-dev" }).channel, "DEVELOPMENT");
  });

  test("an unreadable manifest falls back to development", () => {
    assert.equal(detectAndroidChannel({ manifestRead: false }).channel, "DEVELOPMENT");
  });

  test("a normal release version number is not mistaken for a dev marker", () => {
    // "-rc" is deliberately absent from the marker list: release candidates are
    // what actually ships to workers here.
    assert.equal(detectAndroidChannel({ ...release, versionName: "2.0.0" }).channel, "PRODUCTION");
  });
});

describe("daily series", () => {
  test("zero-fills every day in the window", () => {
    const series = toDailySeries([new Date()], 30);
    assert.equal(series.length, 30);
    assert.equal(series.reduce((n, d) => n + d.count, 0), 1);
  });

  test("counts several events on the same day together", () => {
    const now = new Date();
    const series = toDailySeries([now, now, now], 7);
    assert.equal(series[series.length - 1].count, 3);
  });

  test("an empty month renders as all zeroes rather than throwing", () => {
    const series = toDailySeries([], 30);
    assert.equal(series.length, 30);
    assert.ok(series.every((d) => d.count === 0));
  });
});

describe("bar chart rendering", () => {
  test("emits one titled mark per day", () => {
    const svg = barChart({ data: toDailySeries([new Date()], 7), label: "Uploads" });
    assert.equal((svg.match(/<title>/g) ?? []).length, 7);
  });

  test("carries an accessible summary", () => {
    const svg = barChart({ data: toDailySeries([], 7), label: "Installations" });
    assert.match(svg, /role="img"/);
    assert.match(svg, /aria-label="Installations: 0 over 7 days/);
  });

  test("an all-zero series draws no full-height bars", () => {
    // Without a floor on the divisor, max=0 would make every bar full height.
    const svg = barChart({ data: toDailySeries([], 7), label: "Uploads" });
    assert.equal((svg.match(/<path/g) ?? []).length, 0);
  });

  test("escapes a label rather than letting it break out of the attribute", () => {
    const svg = barChart({ data: toDailySeries([], 3), label: '"><script>bad()</script>' });
    assert.ok(!svg.includes("<script>"), svg.slice(0, 200));
  });
});

describe("size formatting", () => {
  test("a small build reads in KB rather than as 0.0 MB", () => {
    // "0.0 MB" is a rounding artifact, not a size.
    assert.equal(formatSize(1181), "1 KB");
    assert.equal(formatSize(50 * 1024), "50 KB");
  });

  test("a real build reads in MB", () => {
    assert.equal(formatSize(45 * 1024 * 1024), "45.0 MB");
  });

  test("bytes below a kilobyte are shown as bytes", () => {
    assert.equal(formatSize(512), "512 B");
  });

  test("accepts the bigint the database returns", () => {
    assert.equal(formatSize(BigInt(45 * 1024 * 1024)), "45.0 MB");
  });
});

describe("app identity", () => {
  test("only WORKER and CHECKER are accepted", () => {
    for (const a of APPS) assert.ok(isAppKey(a));
    for (const bad of ["", "worker", "Worker", null, undefined, 1, {}, ["WORKER"]]) {
      assert.equal(isAppKey(bad), false, JSON.stringify(bad));
    }
  });

  test("the worker app's exact bundle id resolves to WORKER", () => {
    assert.equal(appForBundleId("com.fhmhotelservices.workerapp"), "WORKER");
  });

  test("the checker app's exact bundle id resolves to CHECKER", () => {
    assert.equal(appForBundleId("com.fhmhotelservices.checkerapp"), "CHECKER");
  });

  test("matching is case-insensitive", () => {
    assert.equal(appForBundleId("COM.FHMHOTELSERVICES.WORKERAPP"), "WORKER");
  });

  test("a channel-suffixed variant still resolves — the suffix is the channel, not the app", () => {
    assert.equal(appForBundleId("com.fhmhotelservices.workerapp.debug"), "WORKER");
    assert.equal(appForBundleId("com.fhmhotelservices.checkerapp.dev"), "CHECKER");
  });

  test("a lookalike id sharing the prefix is NOT treated as a match", () => {
    // "workerappX" is a different app id than "workerapp"; only a dot boundary counts.
    assert.equal(appForBundleId("com.fhmhotelservices.workerappx"), null);
  });

  test("an unrelated bundle id resolves to nothing, not a guess", () => {
    assert.equal(appForBundleId("com.example.someotherapp"), null);
  });

  test("empty or missing input resolves to nothing", () => {
    assert.equal(appForBundleId(""), null);
    // @ts-expect-error — exercising the runtime guard against a bad caller
    assert.equal(appForBundleId(undefined), null);
  });
});

describe("failure reason", () => {
  test("a FAILED build surfaces the parser's error message", () => {
    const reason = failureReason({
      status: "FAILED",
      metadataJson: JSON.stringify({ error: "This is the Checker app — upload it there instead." }),
    });
    assert.equal(reason, "This is the Checker app — upload it there instead.");
  });

  test("a READY build has no failure reason", () => {
    assert.equal(failureReason({ status: "READY", metadataJson: "{}" }), null);
  });

  test("malformed metadata degrades to null rather than throwing", () => {
    assert.equal(failureReason({ status: "FAILED", metadataJson: "not json" }), null);
  });

  test("metadata with no error field degrades to null", () => {
    assert.equal(failureReason({ status: "FAILED", metadataJson: "{}" }), null);
  });
});
