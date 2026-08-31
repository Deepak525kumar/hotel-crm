import plist from "plist";

export type ProfileType = "app-store" | "enterprise" | "ad-hoc" | "development" | "unknown";

export interface ProvisioningProfile {
  name: string;
  teamName?: string;
  teamIdentifier?: string;
  appIdName?: string;
  applicationIdentifier?: string;
  creationDate?: Date;
  expirationDate?: Date;
  /** true => enterprise in-house build, installs on any device */
  provisionsAllDevices: boolean;
  /** Ad Hoc / development: the only UDIDs that can install this build */
  provisionedDevices: string[];
  /** development builds set get-task-allow, which requires Developer Mode on iOS 16+ */
  getTaskAllow: boolean;
  /** APNs entitlement: "development" or "production". A second, independent tell
   *  for whether this is a debug build — see lib/detectChannel.ts. */
  apsEnvironment?: string;
  type: ProfileType;
  daysUntilExpiry: number | null;
  isExpired: boolean;
}

/**
 * embedded.mobileprovision is a PKCS#7 (CMS) SignedData blob whose content is an
 * XML plist. Fully parsing the ASN.1 is possible with node-forge, but the payload
 * is plain XML and the delimiters are unambiguous, so we slice it out directly.
 */
function extractPlistXml(buf: Buffer): string {
  const start = buf.indexOf("<?xml");
  if (start === -1) throw new Error("no plist found in mobileprovision");
  const endMarker = "</plist>";
  const end = buf.indexOf(endMarker, start);
  if (end === -1) throw new Error("truncated plist in mobileprovision");
  return buf.toString("utf8", start, end + endMarker.length);
}

function classify(p: {
  provisionsAllDevices: boolean;
  provisionedDevices: string[];
  getTaskAllow: boolean;
}): ProfileType {
  if (p.provisionsAllDevices) return "enterprise";
  if (p.provisionedDevices.length > 0) return p.getTaskAllow ? "development" : "ad-hoc";
  if (!p.getTaskAllow) return "app-store";
  return "unknown";
}

export function parseMobileProvision(buf: Buffer): ProvisioningProfile {
  const raw = plist.parse(extractPlistXml(buf)) as Record<string, unknown>;

  const entitlements = (raw["Entitlements"] ?? {}) as Record<string, unknown>;
  const provisionsAllDevices = raw["ProvisionsAllDevices"] === true;
  const provisionedDevices = Array.isArray(raw["ProvisionedDevices"])
    ? (raw["ProvisionedDevices"] as string[])
    : [];
  const getTaskAllow = entitlements["get-task-allow"] === true;
  const apsEnvironment = entitlements["aps-environment"]
    ? String(entitlements["aps-environment"])
    : undefined;

  const expirationDate =
    raw["ExpirationDate"] instanceof Date ? (raw["ExpirationDate"] as Date) : undefined;

  let daysUntilExpiry: number | null = null;
  if (expirationDate) {
    daysUntilExpiry = Math.floor((expirationDate.getTime() - Date.now()) / 86_400_000);
  }

  const teamIds = raw["TeamIdentifier"];

  return {
    name: String(raw["Name"] ?? ""),
    teamName: raw["TeamName"] ? String(raw["TeamName"]) : undefined,
    teamIdentifier: Array.isArray(teamIds) ? String(teamIds[0]) : undefined,
    appIdName: raw["AppIDName"] ? String(raw["AppIDName"]) : undefined,
    applicationIdentifier: entitlements["application-identifier"]
      ? String(entitlements["application-identifier"])
      : undefined,
    creationDate: raw["CreationDate"] instanceof Date ? (raw["CreationDate"] as Date) : undefined,
    expirationDate,
    provisionsAllDevices,
    provisionedDevices,
    getTaskAllow,
    apsEnvironment,
    type: classify({ provisionsAllDevices, provisionedDevices, getTaskAllow }),
    daysUntilExpiry,
    isExpired: daysUntilExpiry !== null && daysUntilExpiry < 0,
  };
}

/** True if this device can install the build. Enterprise profiles allow everything. */
export function canDeviceInstall(profile: ProvisioningProfile, udid: string): boolean {
  if (profile.provisionsAllDevices) return true;
  return profile.provisionedDevices.some((d) => d.toLowerCase() === udid.toLowerCase());
}
