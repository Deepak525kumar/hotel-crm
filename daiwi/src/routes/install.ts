import { Router, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import QRCode from "qrcode";
import { pipeline } from "node:stream/promises";
import { prisma } from "../lib/db.js";
import { formatSize } from "../lib/format.js";
import { config } from "../lib/config.js";
import { baseUrl, installPageUrl } from "../lib/env.js";
import {
  buildManifest,
  itmsServicesUrl,
  inspectUserAgent,
  MANIFEST_CONTENT_TYPE,
  APK_CONTENT_TYPE,
} from "../lib/manifest.js";
import { storage } from "../lib/storage.js";
import { minOsLabel } from "./builds.js";
import { PLATFORMS, PLATFORM_DEVICE_LABELS } from "../lib/domain.js";
import { APP_DEFINITIONS } from "../lib/apps.js";
import {
  publicPageLimiter,
  slugMissLimiter,
  downloadLimiter,
  manifestLimiter,
} from "../lib/rateLimits.js";

export const installRouter = Router();

/** Express 4 doesn't forward async rejections to the error middleware on its own. */
function asyncRoute(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => void fn(req, res, next).catch(next);
}

// Anonymous surface. Tiered deliberately (see lib/rateLimits.ts): page views are
// generous because a hotel floor shares one NAT address, while the tight counter
// sits on 404s, which is the only thing an enumeration sweep produces.
installRouter.use(publicPageLimiter);
installRouter.use("/:slug", slugMissLimiter);

/** These pages are public but must never be indexed — the links are the only gate. */
installRouter.use((_req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
});

async function loadActiveBuild(slug: string) {
  return prisma.build.findFirst({ where: { slug, deletedAt: null, status: "READY" } });
}

function presentBuild(build: Awaited<ReturnType<typeof loadActiveBuild>> & object, base: string) {
  return {
    ...build,
    minOs: minOsLabel(build),
    sizeMb: formatSize(build.sizeBytes),
    pageUrl: installPageUrl(base, build.slug),
  };
}

/**
 * Unauthenticated API for the mobile apps to check if a new version exists.
 * e.g. GET /api/latest?app=WORKER&platform=IOS
 */
installRouter.get("/api/latest", asyncRoute(async (req, res) => {
  const { app, platform } = req.query;
  if (typeof app !== "string" || typeof platform !== "string") {
    return res.status(400).json({ error: "Missing app or platform query parameters" });
  }

  const slot = await prisma.releaseSlot.findUnique({
    where: { channel_app_platform: { channel: "PRODUCTION", app, platform } },
    include: { build: true },
  });

  const build = slot?.build && !slot.build.deletedAt && slot.build.status === "READY" ? slot.build : null;
  if (!build) {
    return res.json({ available: false });
  }

  const base = baseUrl(req);
  res.json({
    available: true,
    version: build.version,
    buildNumber: build.buildNumber,
    minOs: minOsLabel(build),
    installUrl: installPageUrl(base, build.slug),
  });
}));

/**
 * The catalogue — one stable URL, the link that goes on a poster or into an
 * onboarding email. It never changes.
 *
 * What it offers is whatever an operator has explicitly promoted into the
 * PRODUCTION slot for each platform — deliberately not "the newest upload", so
 * uploading a build never moves what workers install underneath them. Builds on
 * the DEVELOPMENT channel are never shown here at any time.
 */
installRouter.get("/", asyncRoute(async (req, res) => {
  const base = baseUrl(req);

  const slots = await prisma.releaseSlot.findMany({
    where: { channel: "PRODUCTION" },
    include: { build: true },
  });

  // One group per app (Worker, Checker), each with its own iOS/Android
  // sections — so a worker scanning the page never has to tell which download
  // is meant for them apart from a badge.
  const appGroups = await Promise.all(
    APP_DEFINITIONS.map(async (app) => {
      const sections = await Promise.all(
        PLATFORMS.map(async (platform) => {
          const slot = slots.find((s) => s.app === app.key && s.platform === platform);
          // A slot pointing at a soft-deleted or not-ready build shows as empty
          // rather than as a dead download link.
          const build =
            slot?.build && !slot.build.deletedAt && slot.build.status === "READY" ? slot.build : null;

          const section = {
            key: platform.toLowerCase(),
            platform,
            label: PLATFORM_DEVICE_LABELS[platform],
          };
          if (!build) return { ...section, build: null, qrDataUrl: null };

          return {
            ...section,
            build: presentBuild(build, base),
            qrDataUrl: await QRCode.toDataURL(installPageUrl(base, build.slug), { margin: 1, width: 220 }),
          };
        })
      );

      return { app: app.key, label: app.label, audience: app.audience, sections };
    })
  );

  res.render("catalogue", { appGroups, installPath: config.installPath });
}));

installRouter.get("/:slug", asyncRoute(async (req, res) => {
  const build = await loadActiveBuild(req.params.slug);
  if (!build) return res.status(404).render("not-found");

  const ua = inspectUserAgent(req.get("user-agent") ?? "");
  const base = baseUrl(req);
  const metadata = JSON.parse(build.metadataJson || "{}");

  const manifestUrl = `${base}${config.installPath}/${build.slug}/manifest.plist`;
  // itms-services requires HTTPS; in local dev over plain http, skip the link
  // rather than crash the page — production must set PUBLIC_BASE_URL to https.
  const installHref = manifestUrl.startsWith("https://") ? itmsServicesUrl(manifestUrl) : null;
  const downloadHref = `${base}${config.installPath}/${build.slug}/download`;
  const pageUrl = installPageUrl(base, build.slug);
  const qrDataUrl = await QRCode.toDataURL(pageUrl, { margin: 1, width: 220 });
  const iconUrl = build.iconKey ? `${base}${config.installPath}/${build.slug}/icon` : null;

  const DEVICE_FAMILY_NAMES: Record<number, string> = { 1: "iPhone", 2: "iPad", 3: "Apple TV", 4: "Apple Watch" };
  const deviceFamily = (metadata.supportedDevices ?? [])
    .map((n: number) => DEVICE_FAMILY_NAMES[n] ?? `Unknown (${n})`)
    .join(", ");

  res.render("install", {
    build: presentBuild(build, base),
    metadata,
    ua,
    installHref,
    downloadHref,
    pageUrl,
    qrDataUrl,
    iconUrl,
    deviceFamily,
    installPath: config.installPath,
  });
}));

installRouter.get("/:slug/manifest.plist", manifestLimiter, asyncRoute(async (req, res) => {
  const build = await loadActiveBuild(req.params.slug);
  if (!build || build.platform !== "IOS") return res.status(404).send("Not found");

  const base = baseUrl(req);
  if (!base.startsWith("https://")) {
    return res.status(400).send("Manifest requires an HTTPS origin — set PUBLIC_BASE_URL.");
  }

  const manifest = buildManifest({
    ipaUrl: `${base}${config.installPath}/${build.slug}/download`,
    bundleId: build.bundleId,
    version: build.version,
    title: build.appName,
    displayImageUrl: build.iconKey ? `${base}${config.installPath}/${build.slug}/icon` : undefined,
  });

  res.type(MANIFEST_CONTENT_TYPE).send(manifest);
}));

/**
 * Streams the binary through this service rather than redirecting to a presigned
 * S3 URL. Two reasons: the bucket stays entirely private with no public objects,
 * and the URL never expires mid-download — a presign that lapses while installd
 * is fetching produces an iOS install failure with no error message.
 */
installRouter.get("/:slug/download", downloadLimiter, asyncRoute(async (req, res) => {
  const build = await loadActiveBuild(req.params.slug);
  if (!build) return res.status(404).send("Not found");

  const size = await storage.size(build.storageKey);
  if (size === null) return res.status(410).send("File no longer available");

  const base = build.platform === "IOS" ? `${build.appName}.ipa` : `${build.appName}.apk`;
  // The filename reaches a response header, so everything outside [\w.-] goes.
  const filename = base.replace(/[^\w.-]/g, "_");

  res.setHeader("Content-Type", build.platform === "IOS" ? "application/octet-stream" : APK_CONTENT_TYPE);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", String(size));
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Counted before the bytes move, and deliberately anonymous: build, platform,
  // channel and a timestamp, nothing that identifies the person or the device.
  // The dashboard answers "how many installs this month", never "who".
  await prisma.installEvent.create({
    data: { buildId: build.id, app: build.app, platform: build.platform, channel: build.channel },
  });

  const body = await storage.getStream(build.storageKey);
  // pipeline() destroys the S3 stream if the client disconnects mid-download,
  // which a bare .pipe() would leak on every abandoned install.
  await pipeline(body, res);
}));

installRouter.get("/:slug/icon", asyncRoute(async (req, res) => {
  const build = await loadActiveBuild(req.params.slug);
  if (!build || !build.iconKey) return res.status(404).send("Not found");
  if ((await storage.size(build.iconKey)) === null) return res.status(404).send("Not found");

  res.type("png");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  await pipeline(await storage.getStream(build.iconKey), res);
}));
