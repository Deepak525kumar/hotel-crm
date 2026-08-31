-- CreateTable
CREATE TABLE "InstallEvent" (
    "id" TEXT NOT NULL,
    "buildId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstallEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstallEvent_createdAt_idx" ON "InstallEvent"("createdAt");

-- CreateIndex
CREATE INDEX "InstallEvent_buildId_idx" ON "InstallEvent"("buildId");
