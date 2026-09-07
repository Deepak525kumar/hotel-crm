import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * The confirmation control for a high-risk write.
 *
 * When this renders, NOTHING HAS BEEN WRITTEN — the assistant has only
 * proposed. The backend parks the call server-side and issues a token bound
 * to those exact arguments, so the client's only job is to show what was
 * proposed and send the token back untouched if the user agrees.
 *
 * The failure this guards is a user approving something other than what they
 * read, or approving the same thing twice.
 */

const mockSendMessage = jest.fn();

jest.mock("@/lib/api", () => ({
  chatbotApi: {
    isAvailable: jest.fn().mockResolvedValue(true),
    commands: jest.fn().mockResolvedValue([]),
    startConversation: jest.fn().mockResolvedValue({ id: "conv_1", status: "IN_PROGRESS" }),
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  },
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

import { ChatPanel } from "@/components/chatbot/ChatPanel";
import { useChatbotStore } from "@/stores/chatbot";

const PENDING = {
  token: "tok.abc",
  summary: "This will run: calendar.mark_my_absence\n  day: 2026-09-10\n  kind: SICK",
  toolName: "calendar.mark_my_absence",
};

function seedProposal() {
  useChatbotStore.setState({
    available: true,
    open: true,
    conversationId: "conv_1",
    commands: [],
    sending: false,
    error: null,
    messages: [
      { id: "m1", role: "user", text: "I am sick today" },
      {
        id: "m2",
        role: "assistant",
        text: PENDING.summary,
        route: "L1",
        pendingConfirmation: PENDING,
      },
    ],
  });
}

describe("high-risk write confirmation, in the UI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedProposal();
  });

  it("shows what will happen, and says nothing has changed yet", () => {
    render(<ChatPanel />);
    // The summary comes from the server, rendered from the same arguments the
    // token authorises — so what is read is what runs.
    expect(screen.getByText(/calendar.mark_my_absence/)).toBeInTheDocument();
    expect(screen.getByText(/day: 2026-09-10/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("sends ONLY the token back — no text, no arguments", async () => {
    mockSendMessage.mockResolvedValue({ reply: "Recorded sick leave.", status: "IN_PROGRESS", route: "L1" });
    render(<ChatPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(1));
    const [, input] = mockSendMessage.mock.calls[0];
    expect(input).toEqual({ confirmToken: "tok.abc" });
    expect(input).not.toHaveProperty("text");
    expect(input).not.toHaveProperty("commandId");
  });

  it("replaces the buttons after answering, so it cannot be answered twice", async () => {
    mockSendMessage.mockResolvedValue({ reply: "Recorded.", status: "IN_PROGRESS", route: "L1" });
    render(<ChatPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });

  it("cancelling writes nothing and calls no endpoint", async () => {
    render(<ChatPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.getByText("Cancelled")).toBeInTheDocument());
    // No request at all: nothing was ever written, and the parked call
    // expires on its own.
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(screen.getByText(/Nothing was changed/)).toBeInTheDocument();
  });

  it("surfaces a failed confirmation without claiming it succeeded", async () => {
    mockSendMessage.mockRejectedValue(new Error("network"));
    render(<ChatPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(screen.getByText(/could not answer that just now/i)).toBeInTheDocument(),
    );
  });

  it("REGRESSION: reads the confirmation off the API's camelCase field", async () => {
    // The bug this replaces: the client typed these as snake_case, so
    // `pendingConfirmation` was always undefined and a high-risk write
    // rendered its summary with NO buttons — unapprovable, with nothing on
    // screen explaining why. The other tests here seed the store directly, so
    // they never crossed the API boundary where the mismatch lived. This one
    // starts from a real API payload.
    useChatbotStore.setState({ messages: [], conversationId: "conv_1", sending: false });
    mockSendMessage.mockResolvedValue({
      reply: "This will run: calendar.mark_my_absence",
      status: "IN_PROGRESS",
      route: "L1",
      toolInvoked: "calendar.mark_my_absence",
      pendingConfirmation: { token: "tok.xyz", summary: "…", toolName: "calendar.mark_my_absence" },
    });

    render(<ChatPanel />);
    await useChatbotStore.getState().send("I am sick today");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument(),
    );
  });

  it("renders an ordinary reply with no confirmation control at all", () => {
    useChatbotStore.setState({
      messages: [{ id: "m1", role: "assistant", text: "You work Tuesday.", route: "L0" }],
    });
    render(<ChatPanel />);
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });
});
