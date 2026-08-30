import plist from "plist";

export interface ManifestInput {
  /** HTTPS URL to the .ipa. Must be a CA-signed cert — self-signed fails silently. */
  ipaUrl: string;
  bundleId: string;
  /** CFBundleShortVersionString. Shown on the install confirmation sheet. */
  version: string;
  title: string;
  /** 57x57 PNG, HTTPS. Optional, but without it iOS shows a blank tile. */
  displayImageUrl?: string;
  /** 512x512 PNG, HTTPS. */
  fullSizeImageUrl?: string;
  subtitle?: string;
}

interface Asset {
  kind: string;
  url: string;
  "needs-shine"?: boolean;
}

/**
 * Builds the plist that `installd` fetches after Safari handles an
 * `itms-services://` URL. Every URL inside must be HTTPS and publicly
 * reachable *without cookies* — installd is not the browser and sends
 * neither session cookies nor Authorization headers. Use signed/presigned
 * URLs or capability tokens for access control, never a session.
 */
export function buildManifest(input: ManifestInput): string {
  for (const [field, url] of [
    ["ipaUrl", input.ipaUrl],
    ["displayImageUrl", input.displayImageUrl],
    ["fullSizeImageUrl", input.fullSizeImageUrl],
  ] as const) {
    if (url && !url.startsWith("https://")) {
      throw new Error(`${field} must be https — iOS rejects plain http and self-signed certs`);
    }
  }

  const assets: Asset[] = [{ kind: "software-package", url: input.ipaUrl }];
  if (input.displayImageUrl) {
    assets.push({ kind: "display-image", url: input.displayImageUrl, "needs-shine": false });
  }
  if (input.fullSizeImageUrl) {
    assets.push({ kind: "full-size-image", url: input.fullSizeImageUrl, "needs-shine": false });
  }

  const metadata: Record<string, string> = {
    "bundle-identifier": input.bundleId,
    "bundle-version": input.version,
    kind: "software",
    title: input.title,
  };
  if (input.subtitle) metadata.subtitle = input.subtitle;

  return plist.build({
    items: [{ assets, metadata }],
  } as unknown as plist.PlistValue);
}

/**
 * The URL the Install button points at. The manifest URL must be percent-encoded,
 * or iOS truncates it at the first `&` and the install silently does nothing.
 */
export function itmsServicesUrl(manifestUrl: string): string {
  if (!manifestUrl.startsWith("https://")) {
    throw new Error("manifest URL must be https");
  }
  return `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`;
}

export const MANIFEST_CONTENT_TYPE = "application/xml; charset=utf-8";
export const APK_CONTENT_TYPE = "application/vnd.android.package-archive";

/**
 * iOS in-app browsers (WhatsApp, Slack, Instagram, LinkedIn, Gmail) do not reliably
 * fire the itms-services handler. Detect and prompt the user to open in Safari —
 * this is the single largest source of "the link doesn't work" reports.
 */
export function inspectUserAgent(ua: string): {
  platform: "ios" | "android" | "other";
  isSafari: boolean;
  isInAppBrowser: boolean;
} {
  const isIos = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua));
  const isAndroid = /Android/i.test(ua);
  const isInApp =
    /FBAN|FBAV|Instagram|Line\/|Twitter|WhatsApp|Slack|LinkedInApp|MicroMessenger|GSA\//i.test(ua);
  const isSafari = isIos && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua) && !isInApp;

  return {
    platform: isIos ? "ios" : isAndroid ? "android" : "other",
    isSafari,
    isInAppBrowser: isInApp,
  };
}
