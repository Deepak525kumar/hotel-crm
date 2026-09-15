import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * History, Copy, and the one link a reply may carry.
 *
 * All three from the field report of 2026-09-15, where the assistant refused
 * "I want previous chats" and "make me that chat copy" because nothing on
 * screen could do either, and a manager asking to "create id" for a new
 * employee was sent to an HR department that does not exist.
 */

const mockList = jest.fn();
const mockTranscript = jest.fn();

jest.mock("@/lib/api", () => ({
  chatbotApi: {
    isAvailable: jest.fn().mockResolvedValue(true),
    commands: jest.fn().mockResolvedValue([]),
    startConversation: jest.fn(),
    sendMessage: jest.fn(),
    listConversations: (...args: unknown[]) => mockList(...args),
    getTranscript: (...args: unknown[]) => mockTranscript(...args),
  },
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ChatPanel } from "@/components/chatbot/ChatPanel";
import { useChatbotStore } from "@/stores/chatbot";
import type { ChatMessage } from "@/lib/types";

function seed(messages: ChatMessage[]) {
  useChatbotStore.setState({
    available: true,
    open: true,
    conversationId: "conv_1",
    commands: [],
    sending: false,
    error: null,
    messages,
    view: "chat",
    history: null,
    historyLoading: false,
    historyFailed: false,
    transcript: null,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("the only link an assistant reply may carry", () => {
  it("makes the pre-filled New user form clickable", () => {
    seed([
      {
        id: "m1",
        role: "assistant",
        text: "The New user form is filled in for Mukesh Kumar (worker):\n/users/new#first_name=Mukesh&role=worker\nOpen it, add a profile photo, then press Create.",
      },
    ]);
    render(<ChatPanel />);

    const link = screen.getByRole("link", { name: "Open the filled-in New user form" });
    expect(link.getAttribute("href")).toBe("/users/new#first_name=Mukesh&role=worker");
  });

  /**
   * A model can be talked into writing any URL. Turning arbitrary reply text
   * into links would hand a prompt injection a phishing button.
   */
  it("does not turn any other address in a reply into a link", () => {
    seed([{ id: "m1", role: "assistant", text: "Sign in again at https://evil.example/login or open /settings" }]);
    render(<ChatPanel />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("never makes the person's own text clickable", () => {
    seed([{ id: "m1", role: "user", text: "/users/new#first_name=x" }]);
    render(<ChatPanel />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("Copy -- \"make me that chat copy\"", () => {
  it("copies the conversation as who-said-what", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    seed([
      { id: "m1", role: "user", text: "make me that chat copy" },
      { id: "m2", role: "assistant", text: "Use the Copy button above." },
    ]);
    render(<ChatPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("You: make me that chat copy\n\nZelle: Use the Copy button above."),
    );
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("is not offered when there is nothing to copy", () => {
    seed([]);
    render(<ChatPanel />);
    expect((screen.getByRole("button", { name: "Copy" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("History -- \"I want previous chats\"", () => {
  it("lists earlier conversations and reads one back, with no Confirm to press", async () => {
    mockList.mockResolvedValue([
      {
        id: "c1",
        started_at: "2026-09-15T08:02:00Z",
        status: "IN_PROGRESS",
        opening: "make me plans for parveen 17 18 19 September",
        message_count: 4,
      },
    ]);
    mockTranscript.mockResolvedValue({
      id: "c1",
      messages: [
        { role: "user", text: "make me plans for parveen 17 18 19 September", at: "2026-09-15T08:02:00Z" },
        { role: "assistant", text: "Parveen is available on 17, 18 and 19 September.", at: "2026-09-15T08:02:03Z" },
      ],
    });
    seed([]);
    render(<ChatPanel />);

    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /make me plans for parveen/ }));

    expect(await screen.findByText("Parveen is available on 17, 18 and 19 September.")).toBeTruthy();
    expect(mockTranscript).toHaveBeenCalledWith("c1");
    // A past conversation is read-only: nothing in it can be approved again.
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
    expect(useChatbotStore.getState().view).toBe("chat");
  });

  it("says there are none, rather than that it cannot", async () => {
    mockList.mockResolvedValue([]);
    seed([]);
    render(<ChatPanel />);

    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByText("No conversations from the last 30 days.")).toBeTruthy();
  });

  it("does not lose the live conversation while browsing History", async () => {
    mockList.mockResolvedValue([]);
    seed([{ id: "m1", role: "user", text: "who is working today" }]);
    render(<ChatPanel />);

    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: "Back to chat" }));

    expect(screen.getByText("who is working today")).toBeTruthy();
  });
});
