-- CreateEnum
CREATE TYPE "ChatbotPurpose" AS ENUM ('WORKFORCE_ASSISTANT', 'ONBOARDING_DOCUMENT_COLLECTION', 'GDPR_SUBJECT_RIGHTS');

-- CreateEnum
CREATE TYPE "ChatbotConversationStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FALLBACK_TRIGGERED');

-- CreateTable
CREATE TABLE "ChatbotConversation" (
    "id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "purpose" "ChatbotPurpose" NOT NULL,
    "status" "ChatbotConversationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "hotel_id" TEXT,
    "model_used" TEXT,
    "tokens_input" INTEGER NOT NULL DEFAULT 0,
    "tokens_output" INTEGER NOT NULL DEFAULT 0,
    "turn_count" INTEGER NOT NULL DEFAULT 0,
    "session_state" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "ChatbotConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatbotToolCall" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "turn_index" INTEGER NOT NULL,
    "tool_name" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "args_hash" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "denial_reason" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatbotToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatbotBudgetCounter" (
    "year_month" TEXT NOT NULL,
    "tokens_spent" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatbotBudgetCounter_pkey" PRIMARY KEY ("year_month")
);

-- CreateIndex
CREATE INDEX "ChatbotConversation_worker_id_status_idx" ON "ChatbotConversation"("worker_id", "status");

-- CreateIndex
CREATE INDEX "ChatbotConversation_created_at_idx" ON "ChatbotConversation"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ChatbotToolCall_idempotency_key_key" ON "ChatbotToolCall"("idempotency_key");

-- CreateIndex
CREATE INDEX "ChatbotToolCall_conversation_id_turn_index_idx" ON "ChatbotToolCall"("conversation_id", "turn_index");

-- AddForeignKey
ALTER TABLE "ChatbotConversation" ADD CONSTRAINT "ChatbotConversation_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatbotToolCall" ADD CONSTRAINT "ChatbotToolCall_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ChatbotConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
