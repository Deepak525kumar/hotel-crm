-- Epic 7 PR 7.5 (ADR-029 §4, Consequences: "a PushToken model for PUSH").
-- Adds the PushToken table for registered device push tokens (APNs/FCM), and
-- the PushPlatform enum. Additive only: new table + new enum, no existing
-- column/constraint touched. `token` carries the unique constraint (not
-- user_id+token) -- see the model's own doc comment in schema.prisma for why.

-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('IOS', 'ANDROID');

-- CreateTable
CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "PushPlatform" NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- CreateIndex
CREATE INDEX "PushToken_user_id_idx" ON "PushToken"("user_id");

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
