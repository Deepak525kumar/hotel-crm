-- Epic 7 PR 7.8: multi-app APNs topic support.
--
-- APNs requires the `apns-topic` header to equal the bundle ID of the app that
-- minted the device token; a mismatch is rejected with DeviceTokenNotForTopic.
-- worker-app (com.hotelcrm.workerapp) and checker-app (com.hotelcrm.checkerapp)
-- have distinct bundle IDs, and manager/admin may use BOTH apps, so `platform`
-- alone cannot select the right topic. This adds the missing discriminator.
--
-- Stores the APPLICATION, not the bundle ID: bundle IDs stay deployment
-- configuration (APNS_BUNDLE_ID_WORKER / APNS_BUNDLE_ID_CHECKER), so changing
-- one never requires a data migration.
--
-- Additive: new enum type + new column on PushToken. No existing column,
-- constraint, or index is altered or dropped. The column is NOT NULL with no
-- default -- safe AT THE TIME THIS MIGRATION WAS INTRODUCED (2026-07-24)
-- because PushToken contained zero rows in every deployed environment: its
-- registration endpoint (PR 7.5) had no caller yet, mobile registration
-- (PR 7.7) had not shipped. This is a point-in-time fact about the deploy
-- history at authoring time, not a standing guarantee -- do not assume it
-- still holds when reading this file later. A NOT NULL column avoids an
-- impossible null state that every future delivery path would otherwise
-- have to handle.

-- CreateEnum
CREATE TYPE "PushApp" AS ENUM ('WORKER', 'CHECKER');

-- AlterTable
ALTER TABLE "PushToken" ADD COLUMN "app" "PushApp" NOT NULL;
