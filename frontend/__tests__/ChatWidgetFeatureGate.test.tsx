import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * The assistant must be INVISIBLE when the backend does not serve it.
 *
 * `FEATURE_CHATBOT` is off in production, so every `/chatbot/*` route 404s.
 * A worker must not see a button that errors when pressed, and must not be
 * shown that an unreleased feature exists. This is the whole safety property
 * of shipping the UI before the feature is enabled — so it is tested rather
 * than assumed.
 */

const mockIsAvailable = jest.fn();
const mockCommands = jest.fn();

jest.mock("@/lib/api", () => ({
  chatbotApi: {
    isAvailable: () => mockIsAvailable(),
    commands: () => mockCommands(),
    startConversation: jest.fn(),
    sendMessage: jest.fn(),
  },
}));

let currentPath = "/dashboard";
jest.mock("next/navigation", () => ({
  usePathname: () => currentPath,
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}));

import { ChatWidget } from "@/components/chatbot/ChatWidget";
import { useChatbotStore } from "@/stores/chatbot";

const resetStore = () =>
  useChatbotStore.setState({
    available: null,
    open: false,
    conversationId: null,
    commands: [],
    messages: [],
    sending: false,
    error: null,
  });

describe("ChatWidget feature gate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStore();
    currentPath = "/dashboard";
    mockCommands.mockResolvedValue([]);
  });

  it("renders NOTHING when the backend does not serve the chatbot", async () => {
    mockIsAvailable.mockResolvedValue(false);
    const { container } = render(<ChatWidget />);
    await waitFor(() => expect(useChatbotStore.getState().available).toBe(false));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing while the probe is still in flight", () => {
    // No flash of a button that may then vanish.
    mockIsAvailable.mockReturnValue(new Promise(() => {}));
    const { container } = render(<ChatWidget />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the launcher only once the backend confirms availability", async () => {
    mockIsAvailable.mockResolvedValue(true);
    render(<ChatWidget />);
    expect(await screen.findByRole("button", { name: "Zelle" })).toBeInTheDocument();
  });

  it("opens and closes, keeping aria-expanded truthful", async () => {
    mockIsAvailable.mockResolvedValue(true);
    render(<ChatWidget />);
    const launcher = await screen.findByRole("button", { name: "Zelle" });
    expect(launcher).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(launcher);
    await waitFor(() => expect(useChatbotStore.getState().open).toBe(true));
    expect(screen.getByRole("dialog", { name: "Zelle" })).toBeInTheDocument();
  });

  it("closes on Escape, so keyboard users are not trapped", async () => {
    mockIsAvailable.mockResolvedValue(true);
    render(<ChatWidget />);
    fireEvent.click(await screen.findByRole("button", { name: "Zelle" }));
    await waitFor(() => expect(useChatbotStore.getState().open).toBe(true));

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(useChatbotStore.getState().open).toBe(false));
  });

  it("hides itself on the dedicated assistant page", async () => {
    // The page already IS the assistant; a floating copy on top would be two
    // views of one conversation competing for the same input.
    currentPath = "/assistant";
    mockIsAvailable.mockResolvedValue(true);
    useChatbotStore.setState({ available: true });
    const { container } = render(<ChatWidget />);
    expect(container).toBeEmptyDOMElement();
  });
});
