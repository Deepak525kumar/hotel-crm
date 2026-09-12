import { useChatbotStore } from '@/stores/chatbot-store';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  api: {
    chatbot: {
      isAvailable: jest.fn(),
      probeCommands: jest.fn(),
      commands: jest.fn(),
      startConversation: jest.fn(),
      sendMessage: jest.fn(),
    },
  },
}));

const chatbot = api.chatbot as jest.Mocked<typeof api.chatbot>;

const reset = () =>
  useChatbotStore.setState({
    available: null,
    conversationId: null,
    commands: [],
    messages: [],
    sending: false,
  });

describe('checker-app chatbot store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    reset();
    chatbot.commands.mockResolvedValue([]);
    chatbot.probeCommands.mockResolvedValue([]);
  });

  it('records the feature as unavailable rather than surfacing an error', async () => {
    // Every /chatbot/* route 404s while FEATURE_CHATBOT is off, which was
    // production until 2026-09-09 and is any environment with the flag off. A
    // worker mid-shift must not meet an error they never asked for, and must
    // not learn an unreleased feature exists.
    chatbot.probeCommands.mockResolvedValue(null);
    await useChatbotStore.getState().probe();
    expect(useChatbotStore.getState().available).toBe(false);
  });

  it('probes only once per session', async () => {
    await useChatbotStore.getState().probe();
    await useChatbotStore.getState().probe();
    expect(chatbot.probeCommands).toHaveBeenCalledTimes(1);
  });

  /**
   * ONE REQUEST, NOT TWO. Availability and the chips come from the same
   * endpoint, and this used to fetch it twice in a row -- once via
   * isAvailable(), which discarded the response, then again for the chips.
   * Invisible on a desktop LAN; a visible wait on mobile data, which is how
   * it was reported (2026-09-12).
   */
  it('gets availability and the chips in a single request', async () => {
    chatbot.probeCommands.mockResolvedValue([
      { id: 'my_shifts', label: 'My shifts' },
    ] as never);

    await useChatbotStore.getState().probe();

    expect(chatbot.probeCommands).toHaveBeenCalledTimes(1);
    expect(chatbot.isAvailable).not.toHaveBeenCalled();
    expect(chatbot.commands).not.toHaveBeenCalled();
    expect(useChatbotStore.getState().available).toBe(true);
    expect(useChatbotStore.getState().commands).toHaveLength(1);
  });

  it('still works when the chips come back empty', async () => {
    // Chips are a convenience; free text is the capability.
    chatbot.probeCommands.mockResolvedValue([]);
    await useChatbotStore.getState().probe();
    expect(useChatbotStore.getState().available).toBe(true);
    expect(useChatbotStore.getState().commands).toEqual([]);
  });

  /**
   * A CONVERSATION THE SERVER HAS CLOSED IS NOT REUSABLE.
   *
   * `status` was always on the turn and always ignored, so the id was held
   * until something called reset(). Once the server closed the conversation,
   * every later message went back to the dead id and was refused -- which is
   * how a production user got "You do not have access to that." three times
   * in a row, for "hello" (2026-09-12).
   */
  it('starts a fresh conversation after the server closes one', async () => {
    chatbot.startConversation
      .mockResolvedValueOnce({ id: 'c1', status: 'IN_PROGRESS' })
      .mockResolvedValueOnce({ id: 'c2', status: 'IN_PROGRESS' });
    chatbot.sendMessage.mockResolvedValueOnce({
      reply: 'This conversation has already finished.',
      status: 'FALLBACK_TRIGGERED',
      route: 'none',
    });

    await useChatbotStore.getState().send('hello');
    expect(useChatbotStore.getState().conversationId).toBeNull();

    chatbot.sendMessage.mockResolvedValueOnce({ reply: 'Hi.', status: 'IN_PROGRESS', route: 'L1' });
    await useChatbotStore.getState().send('hello');

    expect(chatbot.startConversation).toHaveBeenCalledTimes(2);
    expect(chatbot.sendMessage).toHaveBeenLastCalledWith('c2', { text: 'hello' });
  });

  it('keeps what is already on screen when the thread restarts', async () => {
    chatbot.startConversation.mockResolvedValue({ id: 'c1', status: 'IN_PROGRESS' });
    chatbot.sendMessage.mockResolvedValue({
      reply: 'This conversation has already finished.',
      status: 'FALLBACK_TRIGGERED',
      route: 'none',
    });

    await useChatbotStore.getState().send('hello');
    // The question and the answer both stay readable; only the server-side
    // thread restarts.
    expect(useChatbotStore.getState().messages).toHaveLength(2);
  });

  it('opens one conversation and reuses it', async () => {
    chatbot.startConversation.mockResolvedValue({ id: 'c1', status: 'IN_PROGRESS' });
    chatbot.sendMessage.mockResolvedValue({ reply: 'ok', status: 'IN_PROGRESS', route: 'L0' });

    await useChatbotStore.getState().send('my shifts');
    await useChatbotStore.getState().send('my contract');

    expect(chatbot.startConversation).toHaveBeenCalledTimes(1);
    expect(chatbot.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('sends a chip by id, never by its label text', async () => {
    // The backend resolves an id with no parsing at all — cheaper and safer
    // than round-tripping a string through the phrase matcher.
    chatbot.startConversation.mockResolvedValue({ id: 'c1', status: 'IN_PROGRESS' });
    chatbot.sendMessage.mockResolvedValue({ reply: '3 shifts found.', status: 'IN_PROGRESS', route: 'L0' });

    await useChatbotStore.getState().runCommand('my_shifts', 'My shifts');
    expect(chatbot.sendMessage).toHaveBeenCalledWith('c1', { commandId: 'my_shifts' });
    // The user's bubble still shows the human label.
    expect(useChatbotStore.getState().messages[0]).toMatchObject({ role: 'user', text: 'My shifts' });
  });

  it('carries a pending confirmation through from the API, on its camelCase field', async () => {
    // The web client typed this snake_case at first, which left high-risk
    // writes with no Confirm button — unapprovable, and nothing on screen
    // explaining why.
    chatbot.startConversation.mockResolvedValue({ id: 'c1', status: 'IN_PROGRESS' });
    chatbot.sendMessage.mockResolvedValue({
      reply: 'This will run: calendar.mark_my_absence',
      status: 'IN_PROGRESS',
      route: 'L1',
      pendingConfirmation: { token: 'tok', summary: 's', toolName: 'calendar.mark_my_absence' },
    });

    await useChatbotStore.getState().send('I am sick today');
    const last = useChatbotStore.getState().messages.at(-1);
    expect(last?.pendingConfirmation?.token).toBe('tok');
  });

  it('confirms with ONLY the token, and marks the proposal answered', async () => {
    chatbot.startConversation.mockResolvedValue({ id: 'c1', status: 'IN_PROGRESS' });
    chatbot.sendMessage.mockResolvedValue({
      reply: 'proposal', status: 'IN_PROGRESS', route: 'L1',
      pendingConfirmation: { token: 'tok', summary: 's', toolName: 'x' },
    });
    await useChatbotStore.getState().send('I am sick today');
    const proposalId = useChatbotStore.getState().messages.at(-1)!.id;

    chatbot.sendMessage.mockResolvedValue({ reply: 'Recorded.', status: 'IN_PROGRESS', route: 'L1' });
    await useChatbotStore.getState().confirm(proposalId, 'tok');

    expect(chatbot.sendMessage).toHaveBeenLastCalledWith('c1', { confirmToken: 'tok' });
    expect(useChatbotStore.getState().messages.find((m) => m.id === proposalId)?.resolved).toBe('confirmed');
  });

  it('cancelling calls no endpoint at all', async () => {
    // Nothing was written, and the parked call expires on its own.
    chatbot.startConversation.mockResolvedValue({ id: 'c1', status: 'IN_PROGRESS' });
    chatbot.sendMessage.mockResolvedValue({
      reply: 'proposal', status: 'IN_PROGRESS', route: 'L1',
      pendingConfirmation: { token: 'tok', summary: 's', toolName: 'x' },
    });
    await useChatbotStore.getState().send('I am sick today');
    const proposalId = useChatbotStore.getState().messages.at(-1)!.id;
    chatbot.sendMessage.mockClear();

    useChatbotStore.getState().cancelConfirmation(proposalId);

    expect(chatbot.sendMessage).not.toHaveBeenCalled();
    expect(useChatbotStore.getState().messages.at(-1)?.text).toMatch(/Nothing was changed/);
  });

  it('shows a failure as a bubble, keeping the question visible', async () => {
    // An alert would have to be dismissed before a worker could re-read what
    // they asked.
    chatbot.startConversation.mockResolvedValue({ id: 'c1', status: 'IN_PROGRESS' });
    chatbot.sendMessage.mockRejectedValue(new Error('network'));

    await useChatbotStore.getState().send('my shifts');
    const msgs = useChatbotStore.getState().messages;
    expect(msgs[0]).toMatchObject({ role: 'user', text: 'my shifts' });
    expect(msgs.at(-1)).toMatchObject({ failed: true });
    expect(useChatbotStore.getState().sending).toBe(false);
  });

  it('ignores an empty message and refuses to double-send', async () => {
    chatbot.startConversation.mockResolvedValue({ id: 'c1', status: 'IN_PROGRESS' });
    await useChatbotStore.getState().send('   ');
    expect(chatbot.sendMessage).not.toHaveBeenCalled();

    useChatbotStore.setState({ sending: true });
    await useChatbotStore.getState().send('hello');
    expect(chatbot.sendMessage).not.toHaveBeenCalled();
  });
});
