-- ADR-027 (2026-07-22, OQ-NOTIF-01): NotificationChannel enum settled at
-- IN_APP/EMAIL/PUSH/SMS/WEBHOOK. Provider-specific integrations (WhatsApp, Slack,
-- etc.) are a transport detail under WEBHOOK (or a future provider field), never a
-- new top-level enum member. Additive only: no existing value renamed or removed,
-- no column default changed (still IN_APP).
ALTER TYPE "NotificationChannel" ADD VALUE 'WEBHOOK';
