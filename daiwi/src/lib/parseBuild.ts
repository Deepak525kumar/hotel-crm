import crypto from "node:crypto";
import fs from "node:fs";
import { prisma } from "./db.js";
import { storage, newKey } from "./storage.js";
import { parseIpa } from "./ipa.js";
import { parseApk } from "./apk.js";
import { APK_CONTENT_TYPE } from "./manifest.js";
import { detectIosChannel, detectAndroidChannel, type ChannelDecision } from "./detectChannel.js";

const IPA_CONTENT_TYPE = "application/octet-stream";

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(path);
    stream.on("data", (c) => hash.update(c));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

interface ParsedFields {
  appName: string;
  bundleId: string;
  version: string;
  buildNumber: string;
  minOsVersion?: string;
  icon?: Buffer;
  metadata: Record<string, unknown>;
  profileExpiry: Date | null;
  provisionsAll: boolean | null;
  provisionedUdids: string[];
  /** Development or production, worked out from the binary — see detectChannel.ts. */
  channel: ChannelDecision;
}

async function parse(platform: string, filePath: string): Promise<ParsedFields> {
  if (platform === "IOS") {
    const info = await parseIpa(filePath);
    return {
      appName: info.appName,
      bundleId: info.bundleId,
      version: info.version,
      buildNumber: info.buildNumber,
      minOsVersion: info.minOsVersion,
      icon: info.icon?.data,
      metadata: {
        platforms: info.platforms,
        supportedDevices: info.supportedDevices,
        requiredDeviceCapabilities: Array.isArray(info.rawInfoPlist["UIRequiredDeviceCapabilities"])
          ? (info.rawInfoPlist["UIRequiredDeviceCapabilities"] as string[])
          : [],
        requiresFullScreen: info.requiresFullScreen,
        warnings: info.warnings,
        profile: info.profile
          ? {
              name: info.profile.name,
              teamName: info.profile.teamName,
              type: info.profile.type,
              expirationDate: info.profile.expirationDate,
              isExpired: info.profile.isExpired,
              daysUntilExpiry: info.profile.daysUntilExpiry,
            }
          : null,
      },
      profileExpiry: info.profile?.expirationDate ?? null,
      provisionsAll: info.profile?.provisionsAllDevices ?? null,
      provisionedUdids: info.profile?.provisionedDevices ?? [],
      channel: detectIosChannel({
        hasProfile: !!info.profile,
        profileType: info.profile?.type,
        getTaskAllow: info.profile?.getTaskAllow,
        apsEnvironment: info.profile?.apsEnvironment,
      }),
    };
  }

  const info = await parseApk(filePath);
  return {
    appName: info.appName,
    bundleId: info.packageName,
    version: info.versionName,
    buildNumber: info.versionCode,
    minOsVersion: info.minSdkVersion,
    icon: info.icon,
    metadata: {
      targetSdkVersion: info.targetSdkVersion,
      debuggable: info.debuggable,
      hasDevClient: info.hasDevClient,
      debugSigned: info.debugSigned,
      warnings: info.warnings,
    },
    profileExpiry: null,
    provisionsAll: null,
    provisionedUdids: [],
    channel: detectAndroidChannel({
      manifestRead: true,
      debuggable: info.debuggable,
      debugSigned: info.debugSigned,
      hasDevClient: info.hasDevClient,
      packageName: info.packageName,
      versionName: info.versionName,
    }),
  };
}

/**
 * Runs off the request thread (fire-and-forget once the upload has landed).
 *
 * The uploaded file is still on local disk at `tmpPath` here — both parsers need
 * a real file path to open — so this hashes it, parses it, ships it to object
 * storage, records the permanent history row, and only then deletes the temp
 * file. If any step throws, the build is marked FAILED and the temp file is
 * still cleaned up; the operator sees the error on the dashboard.
 *
 * A single small VM doesn't need a real queue for this; BullMQ/Redis is a
 * drop-in upgrade if upload volume ever justifies it.
 */
export async function parseBuildAsync(buildId: string, tmpPath: string): Promise<void> {
  const build = await prisma.build.findUnique({ where: { id: buildId }, include: { user: true } });
  if (!build) {
    await fs.promises.rm(tmpPath, { force: true });
    return;
  }

  try {
    const sha256 = await sha256File(tmpPath);
    const sizeBytes = fs.statSync(tmpPath).size;
    const info = await parse(build.platform, tmpPath);

    await storage.putFile(
      build.storageKey,
      tmpPath,
      build.platform === "IOS" ? IPA_CONTENT_TYPE : APK_CONTENT_TYPE
    );

    let iconKey: string | undefined;
    if (info.icon) {
      iconKey = newKey(`icons/${build.id}`, "icon.png");
      await storage.putBuffer(iconKey, info.icon, "image/png");
    }

    // An operator who picked the channel by hand outranks the detector: their
    // choice must survive a re-parse, so only DETECTED builds are reassigned.
    const channelFields =
      build.channelSource === "MANUAL"
        ? {}
        : { channel: info.channel.channel, channelReason: info.channel.reason };

    const updated = await prisma.build.update({
      where: { id: buildId },
      data: {
        ...channelFields,
        appName: info.appName,
        bundleId: info.bundleId,
        version: info.version,
        buildNumber: info.buildNumber,
        minOsVersion: info.minOsVersion,
        sha256,
        sizeBytes: BigInt(sizeBytes),
        iconKey,
        status: "READY",
        metadataJson: JSON.stringify(info.metadata),
        profileExpiry: info.profileExpiry,
        provisionsAll: info.provisionsAll,
        provisionedUdids: JSON.stringify(info.provisionedUdids),
      },
    });

    // Written only once the build is genuinely READY, so the history table
    // never accumulates rows for uploads that turned out to be unparseable.
    await prisma.releaseHistory.create({
      data: {
        buildId: updated.id,
        slug: updated.slug,
        platform: updated.platform,
        channel: updated.channel,
        fileName: updated.fileName,
        appName: updated.appName,
        bundleId: updated.bundleId,
        version: updated.version,
        buildNumber: updated.buildNumber,
        minOsVersion: updated.minOsOverride ?? updated.minOsVersion,
        sizeBytes: updated.sizeBytes,
        sha256: updated.sha256,
        storageKey: updated.storageKey,
        notes: updated.notes,
        uploadedByEmail: build.user.email,
      },
    });
  } catch (err) {
    await prisma.build.update({
      where: { id: buildId },
      data: {
        status: "FAILED",
        metadataJson: JSON.stringify({ error: (err as Error).message }),
      },
    });
  } finally {
    await fs.promises.rm(tmpPath, { force: true });
  }
}
