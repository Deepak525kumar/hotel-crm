import type { Channel } from "./domain.js";

/**
 * Works out whether a build is a debug/test artifact or a release one, from the
 * binary itself, so nobody has to remember to say so at upload time.
 *
 * The rule is asymmetric on purpose. Every signal below is a reason to call
 * something DEVELOPMENT; PRODUCTION is what remains when none of them fire, and
 * anything unreadable falls back to DEVELOPMENT. That is the safe direction: a
 * release build wrongly filed as development is invisible to workers until
 * somebody moves it, whereas a debug build wrongly filed as production sits in
 * the promotable list where one drag publishes it to every phone.
 *
 * Detection never publishes anything by itself — promotion is still a separate,
 * deliberate act — so the cost of a wrong guess is a build on the wrong board.
 */

export interface ChannelDecision {
  channel: Channel;
  /** Shown verbatim on the dashboard, so the decision is auditable rather than magic. */
  reason: string;
}

export interface IosChannelSignals {
  /** Classified provisioning profile: development | ad-hoc | enterprise | app-store | unknown. */
  profileType?: string;
  /** The debugger entitlement. Only development-signed builds carry it. */
  getTaskAllow?: boolean;
  /** APNs entitlement: "development" or "production". */
  apsEnvironment?: string;
  /** False when the IPA carried no embedded.mobileprovision at all. */
  hasProfile: boolean;
}

export interface AndroidChannelSignals {
  /** android:debuggable in the manifest. */
  debuggable?: boolean;
  /** Signed with the Android debug keystore (CN=Android Debug). */
  debugSigned?: boolean;
  /** Expo dev client / dev launcher components present in the manifest. */
  hasDevClient?: boolean;
  packageName?: string;
  versionName?: string;
  /** False when the manifest could not be read well enough to judge. */
  manifestRead: boolean;
}

/** Suffixes a build pipeline conventionally appends to a non-release artifact. */
const DEV_PACKAGE_SUFFIXES = [".debug", ".dev", ".staging", ".test", ".internal"];
const DEV_VERSION_MARKERS = ["-debug", "-dev", "-alpha", "-snapshot", "-local"];

export function detectIosChannel(s: IosChannelSignals): ChannelDecision {
  if (!s.hasProfile) {
    return {
      channel: "DEVELOPMENT",
      reason: "No embedded provisioning profile — the IPA is unsigned or unreadable.",
    };
  }

  // get-task-allow is the debugger entitlement. Apple will not sign a
  // distribution build with it, so its presence is conclusive.
  if (s.getTaskAllow) {
    return {
      channel: "DEVELOPMENT",
      reason: "Signed with a development profile (get-task-allow entitlement present).",
    };
  }

  if (s.profileType === "development") {
    return { channel: "DEVELOPMENT", reason: "Provisioning profile is a development profile." };
  }

  if (s.apsEnvironment === "development") {
    return {
      channel: "DEVELOPMENT",
      reason: "Built against the development APNs environment (aps-environment: development).",
    };
  }

  switch (s.profileType) {
    case "ad-hoc":
      return {
        channel: "PRODUCTION",
        reason: "Ad-hoc release build — no debugger entitlement, installs on registered devices.",
      };
    case "enterprise":
      return {
        channel: "PRODUCTION",
        reason: "Enterprise (in-house) release build — installs on any device.",
      };
    case "app-store":
      // Marked production because that is what it is, even though the existing
      // parser warning already says an App Store build cannot install over the air.
      return {
        channel: "PRODUCTION",
        reason: "App Store distribution build. Note: this cannot be installed over the air.",
      };
    default:
      return {
        channel: "DEVELOPMENT",
        reason: "Provisioning profile could not be classified — filed as development to be safe.",
      };
  }
}

export function detectAndroidChannel(s: AndroidChannelSignals): ChannelDecision {
  if (!s.manifestRead) {
    return {
      channel: "DEVELOPMENT",
      reason: "AndroidManifest could not be read — filed as development to be safe.",
    };
  }

  if (s.debuggable) {
    return { channel: "DEVELOPMENT", reason: 'Manifest sets android:debuggable="true".' };
  }

  if (s.debugSigned) {
    return {
      channel: "DEVELOPMENT",
      reason: "Signed with the Android debug keystore, not a release key.",
    };
  }

  if (s.hasDevClient) {
    return {
      channel: "DEVELOPMENT",
      reason: "Contains the Expo dev client — a developer build, not a release.",
    };
  }

  const pkg = (s.packageName ?? "").toLowerCase();
  const suffix = DEV_PACKAGE_SUFFIXES.find((x) => pkg.endsWith(x));
  if (suffix) {
    return { channel: "DEVELOPMENT", reason: `Application id ends in "${suffix}".` };
  }

  const version = (s.versionName ?? "").toLowerCase();
  const marker = DEV_VERSION_MARKERS.find((x) => version.includes(x));
  if (marker) {
    return { channel: "DEVELOPMENT", reason: `Version name contains "${marker}".` };
  }

  return {
    channel: "PRODUCTION",
    reason: "Release build — not debuggable, release-signed, no developer tooling bundled.",
  };
}
