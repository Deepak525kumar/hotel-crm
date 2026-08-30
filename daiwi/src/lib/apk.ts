// @ts-ignore -- app-info-parser ships no types
import AppInfoParser from "app-info-parser";

export interface ApkInfo {
  packageName: string;
  appName: string;
  versionName: string;
  versionCode: string;
  minSdkVersion?: string;
  targetSdkVersion?: string;
  icon?: Buffer; // decoded data: URI -> buffer, re-encoded as PNG bytes
  warnings: string[];
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

  return {
    packageName,
    appName: String(result?.application?.label ?? packageName),
    versionName: String(result?.versionName ?? "0.0.0"),
    versionCode: String(result?.versionCode ?? "0"),
    minSdkVersion: minSdk,
    targetSdkVersion: targetSdk,
    icon,
    warnings,
  };
}
