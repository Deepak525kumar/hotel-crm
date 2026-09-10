import { act } from "@testing-library/react";
import { useChatbotStore } from "@/stores/chatbot";
import { chatbotApi } from "@/lib/api";

/**
 * Retrying a message that failed.
 *
 * The failure bubble said "please try again" — which, on a phone, mid-shift,
 * meant retyping the whole message they had just watched fail. The request
 * that failed is still in memory, so the bubble can simply resend it.
 *
 * The case that needed thought is the one it does NOT offer: a failed
 * CONFIRMATION. The pending call may already have been cleared server-side,
 * so replaying the token would either do nothing or claim to retry something
 * that is no longer there.
 */

jest.mock("@/lib/api", () => ({
  chatbotApi: {
    startConversation: jest.fn(),
    sendMessage: jest.fn(),
    commands: jest.fn(),
    available: jest.fn(),
  },
}));

const api = chatbotApi as jest.Mocked<typeof chatbotApi>;

beforeEach(() => {
  jest.clearAllMocks();
  useChatbotStore.setState({
    conversationId: "conv_1",
    messages: [],
    sending: false,
    error: null,
  });
  (api.startConversation as jest.Mock).mockResolvedValue({ id: "conv_1" });
});

/** Drives one failed send and returns the failed assistant message. */
async function failOnce(text = "what are my shifts") {
  (api.sendMessage as jest.Mock).mockRejectedValueOnce(new Error("network down"));
  await act(async () => {
    await useChatbotStore.getState().send(text);
  });
  const messages = useChatbotStore.getState().messages;
  return messages[messages.length - 1]!;
}

describe("a failed message can be resent", () => {
  it("keeps the request that failed, so it need not be retyped", async () => {
    const failed = await failOnce("am I working tomorrow");

    expect(failed.failed).toBe(true);
    expect(failed.retry).toEqual({ text: "am I working tomorrow" });
  });

  it("resends exactly what failed", async () => {
    const failed = await failOnce("am I working tomorrow");
    (api.sendMessage as jest.Mock).mockResolvedValueOnce({
      reply: "You are on at 08:00.",
      route: "L1",
    });

    await act(async () => {
      await useChatbotStore.getState().retry(failed.id);
    });

    const [, input] = (api.sendMessage as jest.Mock).mock.calls[1] as [string, unknown];
    expect(input).toEqual({ text: "am I working tomorrow" });
  });

  /**
   * Two "I could not answer that" bubbles for one question read as two
   * failures. The user's own message is still above it saying what was
   * asked, so the failed bubble is replaced rather than stacked.
   */
  it("replaces the failed bubble instead of stacking another", async () => {
    const failed = await failOnce();
    (api.sendMessage as jest.Mock).mockResolvedValueOnce({ reply: "Here you go.", route: "L1" });

    await act(async () => {
      await useChatbotStore.getState().retry(failed.id);
    });

    const messages = useChatbotStore.getState().messages;
    expect(messages.filter((m) => m.failed)).toHaveLength(0);
    // The question, and the answer — not the question twice.
    expect(messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(messages[messages.length - 1]!.text).toBe("Here you go.");
  });

  it("does not echo the question a second time", async () => {
    const failed = await failOnce("who is off today");
    (api.sendMessage as jest.Mock).mockResolvedValueOnce({ reply: "Nobody.", route: "L1" });

    await act(async () => {
      await useChatbotStore.getState().retry(failed.id);
    });

    const asked = useChatbotStore
      .getState()
      .messages.filter((m) => m.role === "user" && m.text === "who is off today");
    expect(asked).toHaveLength(1);
  });

  it("can fail again without losing the ability to retry", async () => {
    const failed = await failOnce();
    (api.sendMessage as jest.Mock).mockRejectedValueOnce(new Error("still down"));

    await act(async () => {
      await useChatbotStore.getState().retry(failed.id);
    });

    const messages = useChatbotStore.getState().messages;
    const latest = messages[messages.length - 1]!;
    expect(latest.failed).toBe(true);
    expect(latest.retry).toBeDefined();
  });

  it("resends a chip by its id, never its label", async () => {
    (api.sendMessage as jest.Mock).mockRejectedValueOnce(new Error("down"));
    await act(async () => {
      await useChatbotStore.getState().runCommand("my_shifts", "My shifts");
    });

    const messages = useChatbotStore.getState().messages;
    const failed = messages[messages.length - 1]!;
    // The LABEL is what was echoed; the ID is what gets resent.
    expect(failed.retry).toEqual({ commandId: "my_shifts" });
  });
});

describe("what it will not retry", () => {
  /**
   * A failed confirmation is not safe to replay: the pending call may
   * already have been cleared, so the token would either do nothing or
   * pretend to retry something that is gone.
   */
  it("offers no retry for a failed confirmation", async () => {
    useChatbotStore.setState({
      messages: [
        {
          id: "m1",
          role: "assistant",
          text: "This will run…",
          pendingConfirmation: { token: "tok", summary: "…", toolName: "t" },
        } as never,
      ],
    });
    (api.sendMessage as jest.Mock).mockRejectedValueOnce(new Error("down"));

    await act(async () => {
      await useChatbotStore.getState().confirm("m1", "tok");
    });

    const messages = useChatbotStore.getState().messages;
    const failed = messages.find((m) => m.failed);
    expect(failed).toBeDefined();
    expect(failed?.retry).toBeUndefined();
  });

  it("does nothing for a message id that carries no request", async () => {
    useChatbotStore.setState({
      messages: [{ id: "m9", role: "assistant", text: "hello" } as never],
    });

    await act(async () => {
      await useChatbotStore.getState().retry("m9");
    });
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("does not fire while a send is already in flight", async () => {
    const failed = await failOnce();
    useChatbotStore.setState({ sending: true });

    await act(async () => {
      await useChatbotStore.getState().retry(failed.id);
    });
    // Only the original failed attempt.
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });
});
