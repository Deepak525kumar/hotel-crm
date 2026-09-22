-- Adds MANAGER to PushApp so the manager app's device tokens can be stored and
-- routed to their own APNs topic.
--
-- ADD VALUE, not a type rewrite: existing WORKER/CHECKER rows keep their oids,
-- no table is rewritten, and a rollback that merely drops the value is safe
-- while no row uses it. Postgres cannot DROP an enum value, so reverting this
-- means recreating the type — which is why nothing should write MANAGER until
-- the app itself ships.
ALTER TYPE "PushApp" ADD VALUE IF NOT EXISTS 'MANAGER';
