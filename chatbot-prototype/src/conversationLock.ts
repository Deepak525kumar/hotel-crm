// OD-CHAT-016 (concurrency) realization guard.
//
// Every turn reads budget/turn state, awaits a provider call, then mutates.
// Without serialization, N concurrent turns on one conversation all pass the
// same pre-turn check and blow straight through the turn ceiling and both
// token caps — measured at 7x the per-conversation cap in a QA probe. The
// window is ~0 in mock mode but is a full network round-trip in live mode,
// which is precisely when overspend costs real money.
//
// Prototype scope: an in-process promise chain per conversation. A real
// multi-process deployment needs a DB row lock or an atomic counter — noted
// here so the limitation is not rediscovered.
const chains = new Map<string, Promise<unknown>>();

export function withConversationLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(conversationId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  // Keep the chain alive but never let a rejection poison later turns.
  chains.set(
    conversationId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}
