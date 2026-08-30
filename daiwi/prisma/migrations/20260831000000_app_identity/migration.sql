-- Adds the app dimension (WORKER | CHECKER) so a build, a promotion slot, a
-- promotion event, a release-history row and an install event all know which
-- app they belong to. Backfilled to 'WORKER' since every build that already
-- existed predates the worker/checker split and was in fact worker-app.
ALTER TABLE "Build" ADD COLUMN "app" TEXT NOT NULL DEFAULT 'WORKER';
ALTER TABLE "InstallEvent" ADD COLUMN "app" TEXT NOT NULL DEFAULT 'WORKER';
ALTER TABLE "PromotionEvent" ADD COLUMN "app" TEXT NOT NULL DEFAULT 'WORKER';
ALTER TABLE "ReleaseHistory" ADD COLUMN "app" TEXT NOT NULL DEFAULT 'WORKER';

-- ReleaseSlot's primary key grows from (channel, platform) to
-- (channel, app, platform): a slot is unique per app now, not shared across both.
ALTER TABLE "ReleaseSlot" ADD COLUMN "app" TEXT NOT NULL DEFAULT 'WORKER';
ALTER TABLE "ReleaseSlot" DROP CONSTRAINT "ReleaseSlot_pkey";
ALTER TABLE "ReleaseSlot" ADD CONSTRAINT "ReleaseSlot_pkey" PRIMARY KEY ("channel", "app", "platform");

CREATE INDEX "Build_app_channel_platform_status_createdAt_idx" ON "Build"("app", "channel", "platform", "status", "createdAt");

ALTER TABLE "Build" ADD COLUMN "appReason" TEXT NOT NULL DEFAULT '';
