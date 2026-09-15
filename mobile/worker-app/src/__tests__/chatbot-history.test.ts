import { conversationAsText, useChatbotStore } from '@/stores/chatbot-store';
import { api } from '@/lib/api';

/**
 * History and sharing, from the field report of 2026-09-15: "I want previous
 * chats" and "make me that chat copy" were both refused, because nothing on
 * the screen could do either.
 */

jest.mock('@/lib/api', () => ({
  api: {
    chatbot: {
      probeCommands: jest.fn(),
      startConversation: jest.fn(),
      sendMessage: jest.fn(),
      listConversations: jest.fn(),
      getTranscript: jest.fn(),
    },
  },
}));

const chatbot = api.chatbot as jest.Mocked<typeof api.chatbot>;

beforeEach(() => {
  jest.clearAllMocks();
  useChatbotStore.setState({
    available: true,
    conversationId: 'conv_live',
    commands: [],
    messages: [{ id: 'm1', role: 'user', text: 'who is working today' }],
    sending: false,
    view: 'chat',
    history: null,
    historyLoading: false,
    historyFailed: false,
    transcript: null,
  });
});

describe('conversationAsText', () => {
  it('labels who said what, so it still reads correctly once pasted', () => {
    expect(
      conversationAsText([
        { role: 'user', text: 'make me that chat copy ' },
        { role: 'assistant', text: 'Tap Copy at the top.' },
      ]),
    ).toBe('You: make me that chat copy\n\nZelle: Tap Copy at the top.');
  });
});

describe('History', () => {
  it('lists the person\'s own conversations when opened', async () => {
    chatbot.listConversations.mockResolvedValue([
      { id: 'c1', started_at: '2026-09-15T08:02:00Z', status: 'IN_PROGRESS', opening: 'hello', message_count: 2 },
    ]);
    await useChatbotStore.getState().openHistory();

    const s = useChatbotStore.getState();
    expect(s.view).toBe('history');
    expect(s.history).toHaveLength(1);
    expect(s.historyFailed).toBe(false);
  });

  it('reads one back without touching the live conversation', async () => {
    chatbot.getTranscript.mockResolvedValue({
      id: 'c1',
      messages: [{ role: 'user', text: 'hello', at: '2026-09-15T08:02:00Z' }],
    });
    await useChatbotStore.getState().openTranscript('c1');

    const s = useChatbotStore.getState();
    expect(chatbot.getTranscript).toHaveBeenCalledWith('c1');
    expect(s.transcript?.messages).toHaveLength(1);
    expect(s.conversationId).toBe('conv_live');
    expect(s.messages).toHaveLength(1);
  });

  it('records a failure instead of throwing at a worker mid-shift', async () => {
    chatbot.listConversations.mockRejectedValue(new Error('offline'));
    await useChatbotStore.getState().openHistory();
    expect(useChatbotStore.getState().historyFailed).toBe(true);
  });

  it('sending a message returns to the live chat', async () => {
    useChatbotStore.setState({ view: 'history' });
    chatbot.sendMessage.mockResolvedValue({ reply: 'ok', status: 'IN_PROGRESS', route: 'L1' });
    await useChatbotStore.getState().send('and tomorrow?');

    expect(useChatbotStore.getState().view).toBe('chat');
    expect(chatbot.sendMessage).toHaveBeenCalledWith('conv_live', { text: 'and tomorrow?' });
  });

  it('New chat leaves the conversation so the next message starts a fresh one', () => {
    useChatbotStore.getState().newChat();
    const s = useChatbotStore.getState();
    expect({ id: s.conversationId, messages: s.messages.length, view: s.view }).toEqual({
      id: null,
      messages: 0,
      view: 'chat',
    });
  });
});
