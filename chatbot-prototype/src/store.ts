// In-memory store standing in for the proposed `ChatbotConversation` Prisma
// model (MIG-GAP-CHAT-003). No DB dependency — this is a standalone prototype.
import type { ChatbotConversation } from "./types.js";

const conversations = new Map<string, ChatbotConversation>();

export const store = {
  save(conversation: ChatbotConversation): void {
    conversations.set(conversation.id, conversation);
  },
  get(id: string): ChatbotConversation | undefined {
    return conversations.get(id);
  },
  all(): ChatbotConversation[] {
    return Array.from(conversations.values());
  },
  clear(): void {
    conversations.clear();
  },
};
