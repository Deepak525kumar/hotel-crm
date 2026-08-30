import yauzl from "yauzl";
import bplist from "bplist-parser";
import plist from "plist";
import { defryPng, isCgBI } from "./png-defry.js";
import { parseMobileProvision, type ProvisioningProfile } from "./mobileprovision.js";

export interface IpaInfo {
  bundleId: string;
  appName: string;
  version: string;        // CFBundleShortVersionString — what users see
  buildNumber: string;    // CFBundleVersion — must increase per upload
  minOsVersion?: string;
  platforms: string[];
  supportedDevices?: number[];
  requiresFullScreen?: boolean;
  icon?: { filename: string; data: Buffer };
  profile?: ProvisioningProfile;
  /** Non-fatal problems worth surfacing on the install page. */
  warnings: string[];
  rawInfoPlist: Record<string, unknown>;
}

/**
 * Info.plist inside an IPA is almost always a BINARY plist. Parsing it as XML
 * yields garbage, so sniff the magic and dispatch.
 */
function parsePlistBuffer(buf: Buffer): Record<string, unknown> {
  if (buf.length >= 8 && buf.toString("ascii", 0, 6) === "bplist") {
    const parsed = bplist.parseBuffer(buf);
    return (parsed[0] ?? {}) as Record<string, unknown>;
  }
  return plist.parse(buf.toString("utf8")) as Record<string, unknown>;
}

/**
 * Matches only the top-level app bundle. Without the anchors this also matches
 * frameworks and app extensions (`Payload/X.app/PlugIns/Y.appex/Info.plist`),
 * which is the most common way IPA parsers report the wrong bundle id.
 */
const INFO_PLIST_RE = /^Payload\/[^/]+\.app\/Info\.plist$/;
const PROFILE_RE = /^Payload\/[^/]+\.app\/embedded\.mobileprovision$/;

/** Icon filenames Xcode emits, largest first. */
function iconCandidates(info: Record<string, unknown>): string[] {
  const names: string[] = [];

  const primary = (info["CFBundleIcons"] as Record<string, unknown> | undefined)?.[
    "CFBundlePrimaryIcon"
  ] as Record<string, unknown> | undefined;
  const files = primary?.["CFBundleIconFiles"];
  if (Array.isArray(files)) names.push(...(files as string[]));

  const legacy = info["CFBundleIconFiles"];
  if (Array.isArray(legacy)) names.push(...(legacy as string[]));

  const single = info["CFBundleIconFile"];
  if (typeof single === "string") names.push(single);

  // Prefer the largest: @3x, then @2x, then plain.
  const expanded: string[] = [];
  for (const n of names.reverse()) {
    const base = n.replace(/\.png$/i, "");
    expanded.push(`${base}@3x.png`, `${base}@2x.png`, `${base}.png`);
  }
  expanded.push("AppIcon60x60@3x.png", "AppIcon60x60@2x.png", "Icon.png");
  return [...new Set(expanded)];
}

function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(err ?? new Error("no read stream"));
      const parts: Buffer[] = [];
      stream.on("data", (c: Buffer) => parts.push(c));
      stream.on("end", () => resolve(Buffer.concat(parts)));
      stream.on("error", reject);
    });
  });
}

/**
 * Reads an IPA from disk. Streams entries rather than loading the archive into
 * memory — production builds routinely exceed 200MB.
 */
export function parseIpa(path: string): Promise<IpaInfo> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("not a valid zip archive"));

      let infoPlistBuf: Buffer | undefined;
      let profileBuf: Buffer | undefined;
      const iconBufs = new Map<string, Buffer>();
      let appDir: string | undefined;
      const pending: Promise<void>[] = [];

      zip.on("entry", (entry: yauzl.Entry) => {
        const name = entry.fileName;

        if (INFO_PLIST_RE.test(name)) {
          appDir = name.slice(0, name.lastIndexOf("/") + 1);
          pending.push(readEntry(zip, entry).then((b) => void (infoPlistBuf = b)));
        } else if (PROFILE_RE.test(name)) {
          pending.push(readEntry(zip, entry).then((b) => void (profileBuf = b)));
        } else if (/^Payload\/[^/]+\.app\/[^/]*\.png$/i.test(name) && entry.uncompressedSize < 2_000_000) {
          // Buffer every top-level PNG; we pick the right one once Info.plist is parsed.
          const base = name.slice(name.lastIndexOf("/") + 1);
          pending.push(readEntry(zip, entry).then((b) => void iconBufs.set(base.toLowerCase(), b)));
        }

        zip.readEntry();
      });

      zip.on("error", reject);

      zip.on("end", () => {
        void (async () => {
          try {
            await Promise.all(pending);
            if (!infoPlistBuf) throw new Error("Info.plist not found — is this a valid IPA?");

            const info = parsePlistBuffer(infoPlistBuf);
            const warnings: string[] = [];

            const bundleId = String(info["CFBundleIdentifier"] ?? "");
            if (!bundleId) throw new Error("CFBundleIdentifier missing from Info.plist");

            const appName =
              String(info["CFBundleDisplayName"] ?? info["CFBundleName"] ?? "") ||
              (appDir ? appDir.split("/")[1].replace(/\.app\/$/, "") : bundleId);

            let profile: ProvisioningProfile | undefined;
            if (profileBuf) {
              try {
                profile = parseMobileProvision(profileBuf);
                if (profile.isExpired) {
                  warnings.push("Provisioning profile has expired — this build will not install.");
                } else if (profile.daysUntilExpiry !== null && profile.daysUntilExpiry <= 30) {
                  warnings.push(`Provisioning profile expires in ${profile.daysUntilExpiry} days.`);
                }
                if (profile.type === "app-store") {
                  warnings.push(
                    "Signed for App Store distribution — over-the-air install will fail. Use an ad hoc or enterprise profile."
                  );
                }
                if (profile.getTaskAllow) {
                  warnings.push("Development build — the device must have Developer Mode enabled (iOS 16+).");
                }
              } catch (e) {
                warnings.push(`Could not read provisioning profile: ${(e as Error).message}`);
              }
            } else {
              warnings.push("No embedded provisioning profile — the IPA may be unsigned.");
            }

            let icon: IpaInfo["icon"];
            for (const candidate of iconCandidates(info)) {
              const buf = iconBufs.get(candidate.toLowerCase());
              if (!buf) continue;
              try {
                icon = { filename: candidate, data: isCgBI(buf) ? defryPng(buf) : buf };
                break;
              } catch {
                // Unrenderable icon is cosmetic; keep looking.
              }
            }
            if (!icon) warnings.push("No usable app icon found; a placeholder will be shown.");

            resolve({
              bundleId,
              appName,
              version: String(info["CFBundleShortVersionString"] ?? "0.0.0"),
              buildNumber: String(info["CFBundleVersion"] ?? "0"),
              minOsVersion: info["MinimumOSVersion"] ? String(info["MinimumOSVersion"]) : undefined,
              platforms: Array.isArray(info["CFBundleSupportedPlatforms"])
                ? (info["CFBundleSupportedPlatforms"] as string[])
                : [],
              supportedDevices: Array.isArray(info["UIDeviceFamily"])
                ? (info["UIDeviceFamily"] as number[])
                : undefined,
              requiresFullScreen: info["UIRequiresFullScreen"] === true,
              icon,
              profile,
              warnings,
              rawInfoPlist: info,
            });
          } catch (e) {
            reject(e);
          }
        })();
      });

      zip.readEntry();
    });
  });
}
