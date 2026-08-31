// @ts-ignore -- app-info-parser ships no types
import AppInfoParser from "app-info-parser";
import yauzl from "yauzl";

export interface ApkInfo {
  packageName: string;
  appName: string;
  versionName: string;
  versionCode: string;
  minSdkVersion?: string;
  targetSdkVersion?: string;
  icon?: Buffer; // decoded data: URI -> buffer, re-encoded as PNG bytes
  /** android:debuggable — set only on debug builds. */
  debuggable: boolean;
  /** Expo's dev client / dev launcher is registered in the manifest. */
  hasDevClient: boolean;
  /** Signed with the Android debug keystore rather than a release key. */
  debugSigned: boolean;
  warnings: string[];
}

/**
 * The debug keystore Android ships with has a fixed distinguished name, so its
 * presence in the signature block is conclusive: a release key never carries it.
 * Matched as raw bytes because the certificate is DER, not text.
 */
const DEBUG_KEY_MARKERS = ["Android Debug", "AndroidDebugKey"];
const SIGNATURE_ENTRY = /^META-INF\/[^/]+\.(RSA|DSA|EC)$/i;

/**
 * Reads the APK's signature block looking for the debug keystore's identity.
 *
 * Only the signature files are inflated — a handful of kilobytes — so this adds
 * nothing meaningful to parse time even for a large APK. A failure here is not
 * fatal: the caller treats "unknown" as "not debug-signed" and relies on the
 * other signals.
 */
function isDebugSigned(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    yauzl.open(path, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return resolve(false);

      let found = false;
      const pending: Promise<void>[] = [];

      zip.on("entry", (entry: yauzl.Entry) => {
        if (!SIGNATURE_ENTRY.test(entry.fileName) || entry.uncompressedSize > 200_000) {
          zip.readEntry();
          return;
        }
        pending.push(
          new Promise<void>((done) => {
            zip.openReadStream(entry, (e, stream) => {
              if (e || !stream) return done();
              const parts: Buffer[] = [];
              stream.on("data", (c: Buffer) => parts.push(c));
              stream.on("end", () => {
                const text = Buffer.concat(parts).toString("latin1");
                if (DEBUG_KEY_MARKERS.some((m) => text.includes(m))) found = true;
                done();
              });
              stream.on("error", () => done());
            });
          })
        );
        zip.readEntry();
      });

      zip.on("error", () => resolve(false));
      zip.on("end", () => void Promise.all(pending).then(() => resolve(found)));
      zip.readEntry();
    });
  });
}

/** Expo registers these components only when the dev client is bundled. */
function detectDevClient(application: Record<string, unknown> | undefined): boolean {
  if (!application) return false;

  const named: string[] = [];
  for (const key of ["activities", "activityAliases", "services", "receivers", "providers"]) {
    const list = application[key];
    if (!Array.isArray(list)) continue;
    for (const component of list) {
      const name = (component as Record<string, unknown>)?.name;
      if (typeof name === "string") named.push(name.toLowerCase());
    }
  }

  return named.some((n) => n.includes("devlauncher") || n.includes("devmenu"));
}

/**
 * AndroidManifest.xml inside an APK is binary AXML, not text. app-info-parser
 * (pure JS) decodes it without needing the Android SDK's aapt2 on the host.
 */
export async function parseApk(path: string): Promise<ApkInfo> {
  const parser = new AppInfoParser(path);
  const result = await parser.parse();
  const warnings: string[] = [];

  const packageName = String(result?.package ?? "");
  if (!packageName) throw new Error("package name missing from AndroidManifest.xml");

  let icon: Buffer | undefined;
  if (typeof result?.icon === "string" && result.icon.startsWith("data:")) {
    const b64 = result.icon.split(",")[1];
    if (b64) icon = Buffer.from(b64, "base64");
  }
  if (!icon) warnings.push("No usable app icon found; a placeholder will be shown.");

  const minSdk = result?.usesSdk?.minSdkVersion ? String(result.usesSdk.minSdkVersion) : undefined;
  const targetSdk = result?.usesSdk?.targetSdkVersion
    ? String(result.usesSdk.targetSdkVersion)
    : undefined;

  const debuggable = result?.application?.debuggable === true;
  const hasDevClient = detectDevClient(result?.application);
  const debugSigned = await isDebugSigned(path);

  if (debuggable) {
    warnings.push("Debuggable build — do not hand this to workers.");
  }

  return {
    packageName,
    appName: String(result?.application?.label ?? packageName),
    versionName: String(result?.versionName ?? "0.0.0"),
    versionCode: String(result?.versionCode ?? "0"),
    minSdkVersion: minSdk,
    targetSdkVersion: targetSdk,
    icon,
    debuggable,
    hasDevClient,
    debugSigned,
    warnings,
  };
}
