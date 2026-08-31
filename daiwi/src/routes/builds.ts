import { Router } from "express";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import Busboy from "busboy";
import { nanoid } from "nanoid";
import QRCode from "qrcode";
import { prisma } from "../lib/db.js";
import { formatSize } from "../lib/format.js";
import { config } from "../lib/config.js";
import { requireAuth } from "../lib/auth.js";
import { newKey, storage, TMP_DIR } from "../lib/storage.js";
import { parseBuildAsync } from "../lib/parseBuild.js";
import { baseUrl, installPageUrl } from "../lib/env.js";
import { uploadLimiter, dashboardApiLimiter } from "../lib/rateLimits.js";
import { CHANNEL_LABELS, isChannel, type Channel } from "../lib/domain.js";
import { APP_DEFINITIONS, APP_LABELS, isAppKey, type AppKey } from "../lib/apps.js";
import { barChart, toDailySeries } from "../lib/sparkline.js";

export const buildsRouter = Router();

function platformForFilename(filename: string): "IOS" | "ANDROID" | null {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".ipa") return "IOS";
  if (ext === ".apk") return "ANDROID";
  return null;
}

/**
 * Display value for min OS: the operator's override wins over what the binary
 * declared.
 *
 * The override is shown verbatim, and only the auto-detected value is
 * translated. An Android binary declares an API level (minSdkVersion 28), but
 * an operator typing in the override box means a version ("9", or "14") — and
 * those two number ranges overlap, so guessing which was meant would render
 * "Android 14" as "Android 10". Taking the human's word for it removes the
 * ambiguity entirely.
 */
/** The error a FAILED build carries — parseBuild.ts writes {error} into metadataJson. */
export function failureReason(build: { status: string; metadataJson: string }): string | null {
  if (build.status !== "FAILED") return null;
  try {
    const parsed = JSON.parse(build.metadataJson || "{}");
    return typeof parsed.error === "string" ? parsed.error : null;
  } catch {
    return null;
  }
}

export function minOsLabel(build: { platform: string; minOsVersion: string | null; minOsOverride: string | null }): string | null {
  const prefix = build.platform === "IOS" ? "iOS" : "Android";

  if (build.minOsOverride) return `${prefix} ${build.minOsOverride}+`;
  if (!build.minOsVersion) return null;
  if (build.platform === "IOS") return `iOS ${build.minOsVersion}+`;

  return `Android ${androidVersionForApiLevel(build.minOsVersion)}+`;
}

const ANDROID_API_LEVELS: Record<string, string> = {
  "21": "5.0", "22": "5.1", "23": "6.0", "24": "7.0", "25": "7.1", "26": "8.0",
  "27": "8.1", "28": "9", "29": "10", "30": "11", "31": "12", "32": "12L",
  "33": "13", "34": "14", "35": "15", "36": "16",
};

/**
 * Turns the minSdkVersion an APK declares into the version number a worker
 * would recognise from their phone's settings screen. Only ever applied to the
 * parsed value, never to an operator's override — see minOsLabel.
 */
export function androidVersionForApiLevel(value: string): string {
  const n = Number(value);
  if (!Number.isInteger(n)) return value;
  return ANDROID_API_LEVELS[String(n)] ?? `API ${n}`;
}

buildsRouter.get("/", requireAuth, async (req, res) => {
  // Every operator sees every build: this is a shared release catalogue, and a
  // colleague's upload being invisible is how two people ship different versions.
  // 30 days of history for the two counters; the charts are zero-filled from it.
  const since = new Date(Date.now() - 30 * 86_400_000);

  const [builds, slots, uploadDates, installDates] = await Promise.all([
    prisma.build.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.releaseSlot.findMany(),
    prisma.build.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.installEvent.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true },
    }),
  ]);
  const base = baseUrl(req);
  const liveBuildIds = new Set(slots.map((s) => s.buildId));

  const uploadSeries = toDailySeries(uploadDates.map((u) => u.createdAt));
  const installSeries = toDailySeries(installDates.map((i) => i.createdAt));

  const presented = builds.map((b) => ({
    ...b,
    sizeMb: formatSize(b.sizeBytes),
    minOs: minOsLabel(b),
    installUrl: installPageUrl(base, b.slug),
    appLabel: APP_LABELS[b.app as AppKey] ?? b.app,
    failureReason: failureReason(b),
    channelLabel: CHANNEL_LABELS[b.channel as Channel] ?? b.channel,
    channelIsManual: b.channelSource === "MANUAL",
    otherChannel: b.channel === "PRODUCTION" ? "DEVELOPMENT" : "PRODUCTION",
    otherChannelLabel: b.channel === "PRODUCTION" ? "Development" : "Production",
    isLive: liveBuildIds.has(b.id),
  }));

  // Two sections, one per app, so the upload area and the build list line up:
  // dropping a file on the Worker dropzone only ever competes with other
  // worker builds for attention.
  const appSections = APP_DEFINITIONS.map((app) => ({
    app: app.key,
    label: app.label,
    audience: app.audience,
    uploadUrl: `${config.adminPath}/api/builds/upload`,
    builds: presented.filter((b) => b.app === app.key),
    latest: presented.find((b) => b.app === app.key && b.status === "READY") ?? null,
  }));

  res.render("dashboard", {
    appSections,
    builds: presented,
    stats: {
      uploads: {
        total: uploadDates.length,
        chart: barChart({ data: uploadSeries, label: "Uploads per day" }),
      },
      installs: {
        total: installDates.length,
        chart: barChart({ data: installSeries, label: "Installations per day" }),
      },
    },
    email: req.session!.email,
    adminPath: config.adminPath,
    installPath: config.installPath,
    catalogueUrl: `${base}${config.installPath}`,
  });
});

/** Permanent, append-only record of every version ever published. */
buildsRouter.get("/history", requireAuth, async (_req, res) => {
  const history = await prisma.releaseHistory.findMany({ orderBy: { uploadedAt: "desc" }, take: 500 });
  res.render("history", {
    history: history.map((h) => ({
      ...h,
      sizeMb: formatSize(h.sizeBytes),
      minOs: minOsLabel({ platform: h.platform, minOsVersion: h.minOsVersion, minOsOverride: null }),
      channelLabel: CHANNEL_LABELS[h.channel as Channel] ?? h.channel,
      appLabel: APP_LABELS[h.app as AppKey] ?? h.app,
    })),
    adminPath: config.adminPath,
  });
});

/** Streamed multipart upload — never buffers the whole file in memory. */
buildsRouter.post("/api/builds/upload", requireAuth, uploadLimiter, (req, res) => {
  const bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: config.maxUploadBytes } });

  let handled = false;
  let notes = "";
  let minOsOverride = "";
  /** Which upload section this came from — required, since there is no default app. */
  let app: AppKey | null = null;
  let appInvalid = false;
  /** Only set when the operator deliberately overrode the detector. */
  let channelOverride: Channel | null = null;
  let channelInvalid = false;
  let sizeLimitHit = false;

  const respond = (status: number, body: object) => {
    if (handled) return;
    handled = true;
    res.status(status).json(body);
  };

  bb.on("field", (name, value) => {
    // Bounded so a client cannot stream an unbounded field into memory.
    if (name === "notes") notes = value.slice(0, 2000);
    if (name === "minOsOverride") minOsOverride = value.slice(0, 32);
    // Optional. Left out, the channel is worked out from the binary during
    // parsing (lib/detectChannel.ts); sent, it is an explicit operator override.
    if (name === "channel" && value) {
      if (isChannel(value)) channelOverride = value;
      else channelInvalid = true;
    }
    if (name === "app") {
      if (isAppKey(value)) app = value;
      else appInvalid = true;
    }
  });

  bb.on("file", (_name, stream, info) => {
    const platform = platformForFilename(info.filename);
    if (!platform) {
      stream.resume();
      respond(400, { error: "Only .ipa and .apk files are supported." });
      return;
    }

    const slug = nanoid(16);
    // Both the storage key and the temp path are server-generated; the client's
    // filename only ever appears after being stripped to [A-Za-z0-9._-].
    const storageKey = newKey(`builds/${slug}`, info.filename);
    // The extension matters, not just cosmetically: app-info-parser (used for
    // .apk) determines file type by splitting the PATH it's given on ".", not
    // by magic bytes or MIME type. An extensionless temp path made it treat
    // every real Android upload as "Unsupported file type" — .ipa never hit
    // this because that path is parsed by lib/ipa.ts, which reads the path
    // only to open it and never inspects the name.
    const tmpExt = platform === "IOS" ? ".ipa" : ".apk";
    const tmpPath = path.join(TMP_DIR, `${slug}-${crypto.randomUUID()}${tmpExt}`);
    const out = fs.createWriteStream(tmpPath);

    stream.on("limit", () => {
      sizeLimitHit = true;
    });
    stream.pipe(out);

    out.on("close", async () => {
      if (handled) {
        await fs.promises.rm(tmpPath, { force: true });
        return;
      }

      try {
        if (sizeLimitHit) {
          await fs.promises.rm(tmpPath, { force: true });
          return respond(413, { error: "File too large." });
        }

        // .ipa and .apk are both zip archives. Checking the magic bytes stops a
        // renamed payload from ever reaching the parsers or object storage.
        const magic = Buffer.alloc(4);
        const fd = await fs.promises.open(tmpPath, "r");
        await fd.read(magic, 0, 4, 0);
        await fd.close();
        if (magic.toString("ascii", 0, 2) !== "PK") {
          await fs.promises.rm(tmpPath, { force: true });
          return respond(400, { error: "Not a valid zip archive (.ipa/.apk are zip files)." });
        }

        if (channelInvalid) {
          await fs.promises.rm(tmpPath, { force: true });
          return respond(400, { error: "Unknown channel." });
        }
        if (appInvalid || !app) {
          await fs.promises.rm(tmpPath, { force: true });
          return respond(400, { error: "Choose the Worker app or Checker app section to upload into." });
        }

        const created = await prisma.build.create({
          data: {
            slug,
            platform,
            app,
            // Starts as DEVELOPMENT and is reassigned once the binary has been
            // read, so a build is never visible as a production candidate during
            // the seconds it spends parsing.
            channel: channelOverride ?? "DEVELOPMENT",
            channelSource: channelOverride ? "MANUAL" : "DETECTED",
            channelReason: channelOverride ? "Set by hand at upload." : "Detecting…",
            fileName: info.filename.slice(0, 255),
            appName: info.filename,
            bundleId: "",
            version: "",
            buildNumber: "",
            minOsOverride: minOsOverride || null,
            storageKey,
            sha256: "",
            sizeBytes: 0n,
            notes: notes || null,
            status: "PARSING",
            metadataJson: "{}",
            provisionedUdids: "[]",
            userId: req.session!.userId,
          },
        });

        respond(201, { id: created.id, slug: created.slug });
        void parseBuildAsync(created.id, tmpPath);
      } catch (err) {
        await fs.promises.rm(tmpPath, { force: true });
        respond(500, { error: (err as Error).message });
      }
    });

    out.on("error", async (err) => {
      await fs.promises.rm(tmpPath, { force: true });
      respond(500, { error: err.message });
    });
  });

  bb.on("error", (err) => respond(400, { error: (err as Error).message }));

  req.pipe(bb);
});

buildsRouter.get("/api/builds", requireAuth, dashboardApiLimiter, async (_req, res) => {
  const builds = await prisma.build.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(
    builds.map((b) => ({
      id: b.id,
      slug: b.slug,
      platform: b.platform,
      app: b.app,
      appReason: b.appReason,
      channel: b.channel,
      channelSource: b.channelSource,
      channelReason: b.channelReason,
      appName: b.appName,
      fileName: b.fileName,
      version: b.version,
      buildNumber: b.buildNumber,
      status: b.status,
      minOs: minOsLabel(b),
      sizeBytes: b.sizeBytes.toString(),
      createdAt: b.createdAt,
    }))
  );
});

buildsRouter.patch("/api/builds/:id", requireAuth, dashboardApiLimiter, async (req, res) => {
  const build = await prisma.build.findFirst({
    where: { id: req.params.id, deletedAt: null },
  });
  if (!build) return res.status(404).json({ error: "not found" });

  const { notes, minOsOverride, channel } = req.body ?? {};
  const data: Record<string, unknown> = {};
  if (typeof notes === "string") data.notes = notes.slice(0, 2000);
  if (typeof minOsOverride === "string") data.minOsOverride = minOsOverride.slice(0, 32) || null;

  if (channel !== undefined) {
    if (!isChannel(channel)) return res.status(400).json({ error: "Unknown channel." });

    // Moving a live build to the other channel would leave the public page
    // pointing at something its own board no longer lists. Take it offline first.
    const liveSlots = await prisma.releaseSlot.count({ where: { buildId: build.id } });
    if (liveSlots > 0) {
      return res.status(409).json({
        error: "This build is live. Take it offline before changing its channel.",
      });
    }

    data.channel = channel;
    // Recorded as MANUAL so a later re-parse cannot silently undo the correction.
    data.channelSource = "MANUAL";
    data.channelReason = `Set to ${CHANNEL_LABELS[channel]} by ${req.session!.email}.`;
  }

  const updated = await prisma.build.update({ where: { id: build.id }, data });
  res.json({
    ok: true,
    minOs: minOsLabel(updated),
    channel: updated.channel,
    channelReason: updated.channelReason,
  });
});

buildsRouter.get("/api/builds/:id/qr", requireAuth, dashboardApiLimiter, async (req, res) => {
  const build = await prisma.build.findFirst({
    where: { id: req.params.id, deletedAt: null },
  });
  if (!build) return res.status(404).end();
  const url = installPageUrl(baseUrl(req), build.slug);
  res.type("png").send(await QRCode.toBuffer(url, { margin: 1, width: 320 }));
});

/**
 * Removes the binary from object storage and retires the build from the public
 * catalogue. The ReleaseHistory row is deliberately kept and only stamped with
 * the deletion — the record of which file and version existed outlives the file.
 */
buildsRouter.delete("/api/builds/:id", requireAuth, dashboardApiLimiter, async (req, res) => {
  const build = await prisma.build.findFirst({
    where: { id: req.params.id, deletedAt: null },
  });
  if (!build) return res.status(404).json({ error: "not found" });

  // A build that is live for a platform is taken out of service first, so the
  // public page never points at a binary that has just been deleted.
  const liveSlots = await prisma.releaseSlot.findMany({ where: { buildId: build.id } });

  await storage.remove(build.storageKey);
  if (build.iconKey) await storage.remove(build.iconKey);

  await prisma.$transaction([
    prisma.releaseSlot.deleteMany({ where: { buildId: build.id } }),
    ...liveSlots.map((slot) =>
      prisma.promotionEvent.create({
        data: {
          channel: slot.channel,
          app: slot.app,
          platform: slot.platform,
          action: "CLEARED",
          replacedBuildId: build.id,
          actorEmail: req.session!.email,
        },
      })
    ),
    prisma.build.update({
      where: { id: build.id },
      data: { status: "DELETED", deletedAt: new Date() },
    }),
    prisma.releaseHistory.updateMany({
      where: { buildId: build.id, binaryDeletedAt: null },
      data: { binaryDeletedAt: new Date(), binaryDeletedBy: req.session!.email },
    }),
  ]);

  res.json({ ok: true, clearedSlots: liveSlots.length });
});
