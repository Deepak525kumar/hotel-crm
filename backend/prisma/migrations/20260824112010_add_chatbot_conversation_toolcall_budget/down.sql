-- Paired rollback (repo convention: every migration ships a down.sql).
--
-- Straightforward compared to most rollbacks here: this migration is purely
-- additive and introduces its own types, so nothing pre-existing is touched
-- and no enum rebuild is needed. The two `NotificationType`-style hazards
-- that make other down.sql files delicate do not apply — `ChatbotPurpose` and
-- `ChatbotConversationStatus` are created by this migration and used by no
-- other table, so they can simply be dropped.
--
-- Order matters: tables before the types they depend on, and ChatbotToolCall
-- before ChatbotConversation (its FK parent). `CASCADE` is deliberately NOT
-- used — if some future object depends on these, the drop should fail loudly
-- rather than silently remove it.
--
-- Data loss is total and intended: rolling this back removes every chatbot
-- conversation record, tool-call log row, and the monthly budget counter.
-- None of it is business state owned by another module (ADR-053 item 1 --
-- the chatbot owns no business state beyond its own conversation record), so
-- there is nothing here another module needs to survive the rollback.

DROP TABLE IF EXISTS "ChatbotToolCall";
DROP TABLE IF EXISTS "ChatbotConversation";
DROP TABLE IF EXISTS "ChatbotBudgetCounter";

DROP TYPE IF EXISTS "ChatbotConversationStatus";
DROP TYPE IF EXISTS "ChatbotPurpose";
