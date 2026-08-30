-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "requestedIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Build" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'PRODUCTION',
    "fileName" TEXT NOT NULL DEFAULT '',
    "appName" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "buildNumber" TEXT NOT NULL,
    "minOsVersion" TEXT,
    "minOsOverride" TEXT,
    "storageKey" TEXT NOT NULL,
    "iconKey" TEXT,
    "sha256" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL,
    "metadataJson" TEXT NOT NULL,
    "profileExpiry" TIMESTAMP(3),
    "provisionsAll" BOOLEAN,
    "provisionedUdids" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Build_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseSlot" (
    "channel" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "buildId" TEXT NOT NULL,
    "promotedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "promotedByEmail" TEXT NOT NULL,

    CONSTRAINT "ReleaseSlot_pkey" PRIMARY KEY ("channel","platform")
);

-- CreateTable
CREATE TABLE "PromotionEvent" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'PRODUCTION',
    "platform" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "buildId" TEXT,
    "version" TEXT,
    "buildNumber" TEXT,
    "fileName" TEXT,
    "replacedBuildId" TEXT,
    "actorEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseHistory" (
    "id" TEXT NOT NULL,
    "buildId" TEXT,
    "slug" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'PRODUCTION',
    "fileName" TEXT NOT NULL,
    "appName" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "buildNumber" TEXT NOT NULL,
    "minOsVersion" TEXT,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "notes" TEXT,
    "uploadedByEmail" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "binaryDeletedAt" TIMESTAMP(3),
    "binaryDeletedBy" TEXT,

    CONSTRAINT "ReleaseHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Build_slug_key" ON "Build"("slug");

-- CreateIndex
CREATE INDEX "Build_userId_idx" ON "Build"("userId");

-- CreateIndex
CREATE INDEX "Build_platform_status_createdAt_idx" ON "Build"("platform", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Build_channel_platform_status_createdAt_idx" ON "Build"("channel", "platform", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ReleaseSlot_buildId_idx" ON "ReleaseSlot"("buildId");

-- CreateIndex
CREATE INDEX "PromotionEvent_channel_platform_createdAt_idx" ON "PromotionEvent"("channel", "platform", "createdAt");

-- CreateIndex
CREATE INDEX "ReleaseHistory_platform_uploadedAt_idx" ON "ReleaseHistory"("platform", "uploadedAt");

-- CreateIndex
CREATE INDEX "ReleaseHistory_buildId_idx" ON "ReleaseHistory"("buildId");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Build" ADD CONSTRAINT "Build_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseSlot" ADD CONSTRAINT "ReleaseSlot_buildId_fkey" FOREIGN KEY ("buildId") REFERENCES "Build"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
