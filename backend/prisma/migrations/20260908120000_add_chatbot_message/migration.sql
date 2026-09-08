-- Conversation transcripts (OD-CHAT-008 / OD-CHAT-018, owner decision
-- 2026-09-08: stored, encrypted at rest, retained 30 days).
--
-- `content` holds AES-256-GCM ciphertext, never plaintext. Only USER rows are
-- ever replayed into a prompt; ASSISTANT rows exist for audit, support and
-- data-subject access (ADR-074 section 5).

CREATE TYPE "ChatbotMessageRole" AS ENUM ('USER', 'ASSISTANT');

CREATE TABLE "ChatbotMessage" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "turn_index" INTEGER NOT NULL,
    "role" "ChatbotMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatbotMessage_pkey" PRIMARY KEY ("id")
);

-- The replay query: one conversation, USER rows, ordered by turn.
CREATE INDEX "ChatbotMessage_conversation_id_role_turn_index_idx"
    ON "ChatbotMessage"("conversation_id", "role", "turn_index");

-- The 30-day retention sweep.
CREATE INDEX "ChatbotMessage_created_at_idx" ON "ChatbotMessage"("created_at");

-- Cascade: a deleted conversation takes its transcript with it, and a deleted
-- user takes their conversations. A data-deletion request therefore reaches
-- transcripts without a bespoke path.
ALTER TABLE "ChatbotMessage"
    ADD CONSTRAINT "ChatbotMessage_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "ChatbotConversation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
