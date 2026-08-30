import { Router } from "express";
import { prisma } from "../lib/db.js";
import { config } from "../lib/config.js";
import { requireAuth } from "../lib/auth.js";
import { promotionLimiter } from "../lib/rateLimits.js";
import { baseUrl, installPageUrl, catalogueUrl } from "../lib/env.js";
import {
  PLATFORMS,
  CHANNEL_LABELS,
  PLATFORM_DEVICE_LABELS,
  isChannel,
  isPlatform,
  type Channel,
} from "../lib/domain.js";
import { minOsLabel } from "./builds.js";

export const promotionRouter = Router();

function present(build: {
  id: string; slug: string; platform: string; appName: string; fileName: string;
  version: string; buildNumber: string; sizeBytes: bigint; createdAt: Date;
  minOsVersion: string | null; minOsOverride: string | null; iconKey: string | null;
}, base: string) {
  return {
    id: build.id,
    slug: build.slug,
    platform: build.platform,
    appName: build.appName,
    fileName: build.fileName,
    version: build.version,
    buildNumber: build.buildNumber,
    sizeMb: (Number(build.sizeBytes) / (1024 * 1024)).toFixed(1),
    createdAt: build.createdAt,
    minOs: minOsLabel(build),
    hasIcon: !!build.iconKey,
    installUrl: installPageUrl(base, build.slug),
  };
}

/**
 * The promotion board for one channel: a drop box per platform showing what is
 * live, and the pool of eligible builds underneath it.
 */
async function renderBoard(channel: Channel, req: import("express").Request, res: import("express").Response) {
  const base = baseUrl(req);

  const [slots, builds] = await Promise.all([
    prisma.releaseSlot.findMany({ where: { channel }, include: { build: true } }),
    prisma.build.findMany({
      where: { channel, status: "READY", deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const boards = PLATFORMS.map((platform) => {
    const slot = slots.find((s) => s.platform === platform);
    return {
      platform,
      label: PLATFORM_DEVICE_LABELS[platform],
      live: slot?.build && !slot.build.deletedAt ? present(slot.build, base) : null,
      promotedAt: slot?.promotedAt ?? null,
      promotedByEmail: slot?.promotedByEmail ?? null,
      candidates: builds.filter((b) => b.platform === platform).map((b) => present(b, base)),
    };
  });

  res.render("promotion", {
    channel,
    channelLabel: CHANNEL_LABELS[channel],
    boards,
    adminPath: config.adminPath,
    // Development builds are never advertised on the workers' page; that page
    // only ever reflects the PRODUCTION slots.
    publicUrl: channel === "PRODUCTION" ? catalogueUrl(base) : null,
  });
}

promotionRouter.get("/production", requireAuth, (req, res) => renderBoard("PRODUCTION", req, res));
promotionRouter.get("/development", requireAuth, (req, res) => renderBoard("DEVELOPMENT", req, res));

/**
 * Promotes a build into a channel/platform slot.
 *
 * The channel and platform are taken from the *build row*, never from the
 * request body — a client cannot drop an Android build into the iOS box, or a
 * development build into the production one, by editing the payload.
 */
promotionRouter.post("/api/promote", requireAuth, promotionLimiter, async (req, res) => {
  const { buildId, channel, platform } = req.body ?? {};

  if (!isChannel(channel) || !isPlatform(platform)) {
    return res.status(400).json({ error: "Unknown channel or platform." });
  }
  if (typeof buildId !== "string" || !buildId) {
    return res.status(400).json({ error: "buildId is required." });
  }

  const build = await prisma.build.findFirst({
    where: { id: buildId, status: "READY", deletedAt: null },
  });
  if (!build) return res.status(404).json({ error: "Build not found, or not ready yet." });

  if (build.platform !== platform) {
    return res.status(409).json({
      error: `That is an ${build.platform === "IOS" ? "iOS" : "Android"} build — it cannot go in the ${platform === "IOS" ? "iOS" : "Android"} box.`,
    });
  }
  if (build.channel !== channel) {
    return res.status(409).json({
      error: `That build was uploaded to the ${CHANNEL_LABELS[build.channel as Channel] ?? build.channel} channel and cannot be promoted here.`,
    });
  }

  const existing = await prisma.releaseSlot.findUnique({
    where: { channel_platform: { channel, platform } },
  });
  if (existing?.buildId === build.id) {
    return res.json({ ok: true, unchanged: true });
  }

  await prisma.$transaction([
    prisma.releaseSlot.upsert({
      where: { channel_platform: { channel, platform } },
      create: { channel, platform, buildId: build.id, promotedByEmail: req.session!.email },
      update: { buildId: build.id, promotedAt: new Date(), promotedByEmail: req.session!.email },
    }),
    prisma.promotionEvent.create({
      data: {
        channel,
        platform,
        action: "PROMOTED",
        buildId: build.id,
        version: build.version,
        buildNumber: build.buildNumber,
        fileName: build.fileName,
        replacedBuildId: existing?.buildId ?? null,
        actorEmail: req.session!.email,
      },
    }),
  ]);

  res.json({ ok: true });
});

/** Takes a platform's slot out of service — the public page then shows nothing for it. */
promotionRouter.delete("/api/promote/:channel/:platform", requireAuth, promotionLimiter, async (req, res) => {
  const { channel, platform } = req.params;
  if (!isChannel(channel) || !isPlatform(platform)) {
    return res.status(400).json({ error: "Unknown channel or platform." });
  }

  const existing = await prisma.releaseSlot.findUnique({
    where: { channel_platform: { channel, platform } },
  });
  if (!existing) return res.status(404).json({ error: "Nothing is live for that platform." });

  await prisma.$transaction([
    prisma.releaseSlot.delete({ where: { channel_platform: { channel, platform } } }),
    prisma.promotionEvent.create({
      data: {
        channel,
        platform,
        action: "CLEARED",
        replacedBuildId: existing.buildId,
        actorEmail: req.session!.email,
      },
    }),
  ]);

  res.json({ ok: true });
});

/** Promotion timeline — when each version started reaching devices, and who sent it. */
promotionRouter.get("/api/promotions", requireAuth, async (req, res) => {
  const channel = isChannel(req.query.channel) ? req.query.channel : undefined;
  const events = await prisma.promotionEvent.findMany({
    where: channel ? { channel } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(events);
});
