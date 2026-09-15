import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSpeechInput } from '@/hooks/use-speech-input';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BackLink } from '@/components/BackLink';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { conversationAsText, useChatbotStore, type ChatMessage } from '@/stores/chatbot-store';

/**
 * The assistant screen.
 *
 * REDIRECTS AWAY when the backend does not serve the chatbot, which is its
 * state in production (`FEATURE_CHATBOT` is off). A route that resolves to a
 * dead screen is worse than one that does not resolve, and rendering an
 * empty shell would confirm an unreleased feature exists.
 *
 * HISTORY, SHARE AND NEW (2026-09-15). "I want previous chats" and "make me
 * that chat copy" were both refused in real use, because nothing on screen
 * could do either. Share rather than a clipboard button: these apps carry no
 * clipboard module, and the system share sheet already offers Copy alongside
 * WhatsApp and mail, which is where a copied chat goes next anyway.
 */
export default function AssistantScreen() {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const {
    available,
    probe,
    messages,
    commands,
    sending,
    send,
    runCommand,
    confirm,
    cancelConfirmation,
    retry,
    view,
    history,
    historyLoading,
    historyFailed,
    transcript,
    openHistory,
    openTranscript,
    backToChat,
    newChat,
  } = useChatbotStore();
  const [draft, setDraft] = useState('');

  // What the field held when dictation started. Speech ADDS to it rather
  // than replacing it, so someone can type half a sentence, tap the
  // microphone and say the rest.
  const dictationBase = useRef('');

  const speech = useSpeechInput({
    language: i18n?.language?.split('-')[0] ?? 'en',
    onTranscript: (text) => {
      const base = dictationBase.current;
      setDraft(base ? `${base.replace(/\s*$/, '')} ${text}` : text);
    },
  });

  const onMicPress = () => {
    if (speech.listening) {
      speech.stop();
      return;
    }
    dictationBase.current = draft;
    void speech.start();
  };
  const listRef = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => {
    void probe();
  }, [probe]);

  useEffect(() => {
    if (available === false) router.replace('/');
  }, [available, router]);

  // Keep the newest turn visible as the conversation grows.
  useEffect(() => {
    if (messages.length > 0) listRef.current?.scrollToEnd({ animated: true });
  }, [messages, sending]);

  const submit = useCallback(() => {
    const text = draft;
    setDraft('');
    void send(text);
  }, [draft, send]);

  const shareSource = view === 'transcript' ? (transcript?.messages ?? []) : view === 'chat' ? messages : [];

  const share = async () => {
    if (shareSource.length === 0) return;
    try {
      await Share.share({ message: conversationAsText(shareSource) });
    } catch {
      // Dismissed or unavailable: nothing was lost, and nothing to report.
    }
  };

  // Berlin, like every other time on this platform.
  const when = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(i18n?.language ?? 'en', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Europe/Berlin',
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  if (available !== true) {
    return (
      <SafeAreaView style={[styles.fill, { backgroundColor: theme.background }]}>
        <View style={styles.centre}>
          {available === null ? <ActivityIndicator color={theme.primary} /> : null}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: theme.background }]} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        // Without this the composer sits under the keyboard on iOS and a
        // worker cannot see what they are typing.
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <View style={styles.header}>
          {view === 'chat' ? (
            <BackLink />
          ) : (
            <HeaderAction label={t('chatbot.historyBack', 'Back to chat')} onPress={backToChat} />
          )}
          <ThemedText type="subtitle" style={styles.title}>
            {t('chatbot.title', 'Zelle')}
          </ThemedText>
          <HeaderAction label={t('chatbot.history', 'History')} onPress={() => void openHistory()} />
          <HeaderAction
            label={t('chatbot.copy', 'Copy')}
            disabled={shareSource.length === 0}
            onPress={() => void share()}
          />
          <HeaderAction label={t('chatbot.newChat', 'New chat')} disabled={sending} onPress={newChat} />
        </View>

        {view === 'history' ? (
          <FlatList
            data={history ?? []}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <View style={styles.historyHeader}>
                <ThemedText type="subtitle">{t('chatbot.historyTitle', 'Earlier conversations')}</ThemedText>
                {historyLoading ? <ActivityIndicator color={theme.textSecondary} /> : null}
                {!historyLoading && historyFailed ? (
                  <ThemedText style={{ color: theme.textSecondary }}>
                    {t('chatbot.historyFailed', 'Could not load your conversations.')}
                  </ThemedText>
                ) : null}
                {!historyLoading && !historyFailed && (history ?? []).length === 0 ? (
                  <ThemedText style={{ color: theme.textSecondary }}>
                    {t('chatbot.historyEmpty', 'No conversations from the last 30 days.')}
                  </ThemedText>
                ) : null}
              </View>
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => void openTranscript(item.id)}
                style={[styles.historyItem, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
              >
                <ThemedText style={[styles.historyWhen, { color: theme.textSecondary }]}>
                  {when(item.started_at)}
                </ThemedText>
                <ThemedText numberOfLines={2}>{item.opening ?? '…'}</ThemedText>
              </Pressable>
            )}
          />
        ) : view === 'transcript' ? (
          <FlatList
            data={(transcript?.messages ?? []).map((m, i) => ({ id: `t${i}`, role: m.role, text: m.text }))}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              historyLoading ? (
                <ActivityIndicator color={theme.textSecondary} />
              ) : historyFailed ? (
                <ThemedText style={{ color: theme.textSecondary }}>
                  {t('chatbot.historyFailed', 'Could not load your conversations.')}
                </ThemedText>
              ) : null
            }
            renderItem={({ item }) => <Bubble message={item} />}
          />
        ) : messages.length === 0 ? (
          <View style={styles.centre}>
            <ThemedText type="subtitle" style={styles.greeting}>
              {t('chatbot.greeting', 'How can I help?')}
            </ThemedText>
            <ThemedText style={[styles.hint, { color: theme.textSecondary }]}>
              {t('chatbot.greetingHint', 'Ask a question, or pick one below.')}
            </ThemedText>

            {/* Chips answer without calling a model at all, so they are both
                instant and free. Shown prominently for that reason. */}
            <View style={styles.chips}>
              {commands.map((c) => (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  disabled={sending}
                  onPress={() => void runCommand(c.id, c.label)}
                  style={[styles.chip, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                >
                  <ThemedText style={styles.chipText}>{c.label}</ThemedText>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <Bubble
                message={item}
                onConfirm={() =>
                  item.pendingConfirmation && void confirm(item.id, item.pendingConfirmation.token)
                }
                onCancel={() => cancelConfirmation(item.id)}
                onRetry={() => void retry(item.id)}
              />
            )}
            ListFooterComponent={
              sending ? (
                <View style={styles.typing}>
                  <ActivityIndicator color={theme.textSecondary} />
                </View>
              ) : null
            }
          />
        )}

        {view === 'chat' ? (
          <View style={[styles.composer, { borderTopColor: theme.border, backgroundColor: theme.backgroundElement }]}>
            {speech.error ? (
              <ThemedText style={[styles.micError, { color: theme.textSecondary }]}>
                {speech.error === 'denied'
                  ? t('chatbot.micDenied', 'Microphone access is off. Turn it on in Settings to dictate.')
                  : t('chatbot.micFailed', 'Dictation did not work. You can type instead.')}
              </ThemedText>
            ) : null}

            {/* ONE surface, not a boxed field beside a word-button. The row owns
                the border; the field and its two round controls sit inside it,
                which is the shape every assistant on a phone already uses. */}
            <View style={[styles.inputRow, { borderColor: theme.border, backgroundColor: theme.background }]}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={
                  speech.listening
                    ? t('chatbot.listening', 'Listening…')
                    : t('chatbot.placeholder', 'Ask about your shifts, contract or messages…')
                }
                placeholderTextColor={theme.textSecondary}
                accessibilityLabel={t('chatbot.inputLabel', 'Message')}
                multiline
                style={[styles.input, { color: theme.text }]}
              />

              {/* Dictation. A microphone glyph rather than an icon component:
                  these apps ship no vector library, and one drawn shape is not
                  worth a native dependency. */}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: speech.listening }}
                accessibilityLabel={
                  speech.listening
                    ? t('chatbot.stopDictation', 'Stop dictating')
                    : t('chatbot.dictate', 'Dictate a message')
                }
                disabled={sending}
                onPress={onMicPress}
                style={[
                  styles.circle,
                  speech.listening
                    ? { backgroundColor: '#DC2626' }
                    : { backgroundColor: 'transparent' },
                ]}
              >
                <ThemedText style={[styles.glyph, speech.listening ? styles.glyphOnColor : { color: theme.textSecondary }]}>
                  {speech.listening ? '■' : '🎤'}
                </ThemedText>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('chatbot.send', 'Send')}
                disabled={sending || draft.trim().length === 0}
                onPress={submit}
                style={[
                  styles.circle,
                  {
                    backgroundColor:
                      draft.trim().length === 0 || sending ? theme.border : theme.primary,
                  },
                ]}
              >
                {/* An upward arrow, the same affordance as the web composer. */}
                <ThemedText style={[styles.glyph, styles.glyphOnColor]}>{'↑'}</ThemedText>
              </Pressable>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** A small text button in the header. Words, not glyphs: these apps ship no icon set. */
function HeaderAction({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[styles.headerAction, disabled ? styles.disabled : null]}
    >
      <ThemedText style={[styles.headerActionText, { color: theme.primary }]}>{label}</ThemedText>
    </Pressable>
  );
}

function Bubble({
  message,
  onConfirm,
  onCancel,
  onRetry,
}: {
  message: ChatMessage;
  onConfirm?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const isUser = message.role === 'user';

  return (
    <View style={[styles.row, isUser ? styles.rowRight : styles.rowLeft]}>
      <View style={styles.bubbleWrap}>
        <ThemedView
          style={[
            styles.bubble,
            {
              backgroundColor: isUser
                ? theme.primary
                : message.failed
                  ? theme.warningSubtle
                  : theme.backgroundElement,
              borderColor: theme.border,
            },
          ]}
        >
          <ThemedText style={{ color: isUser ? '#FFFFFF' : theme.text }}>{message.text}</ThemedText>

          {/* RETRY, rather than making them type it all again.
              "Please try again" meant retyping the whole message on a phone,
              in gloves, having just watched it fail. The request is still
              held, so this resends it. Absent on a failed confirmation,
              which is not safe to replay -- see the store. */}
          {message.failed && message.retry && onRetry ? (
            <Pressable
              accessibilityRole="button"
              onPress={onRetry}
              style={[styles.retry, { borderColor: theme.border }]}
            >
              <ThemedText style={[styles.retryText, { color: theme.text }]}>
                {t('chatbot.retry', 'Try again')}
              </ThemedText>
            </Pressable>
          ) : null}
        </ThemedView>

        {/* NOTHING HAS BEEN WRITTEN when this renders — the assistant has only
            proposed. The summary above comes from the server, rendered from
            the exact arguments the confirmation token authorises, so what a
            person reads is what runs. */}
        {message.pendingConfirmation && onConfirm && onCancel ? (
          message.resolved ? (
            <ThemedText style={[styles.resolved, { color: theme.textSecondary }]}>
              {message.resolved === 'confirmed'
                ? t('chatbot.confirmed', 'Confirmed')
                : t('chatbot.cancelled', 'Cancelled')}
            </ThemedText>
          ) : (
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                onPress={onConfirm}
                style={[styles.action, { backgroundColor: theme.primary }]}
              >
                <ThemedText style={styles.actionText}>{t('chatbot.confirm', 'Confirm')}</ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={onCancel}
                style={[styles.action, { borderWidth: 1, borderColor: theme.border }]}
              >
                <ThemedText>{t('chatbot.cancel', 'Cancel')}</ThemedText>
              </Pressable>
            </View>
          )
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
  },
  title: { flex: 1 },
  headerAction: { paddingHorizontal: Spacing.one, paddingVertical: Spacing.one },
  headerActionText: { fontSize: 13, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  historyHeader: { gap: Spacing.two, marginBottom: Spacing.two },
  historyItem: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.one,
  },
  historyWhen: { fontSize: 12 },
  greeting: { fontSize: 18, textAlign: 'center' },
  hint: { marginTop: Spacing.two, textAlign: 'center' },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  chipText: { fontSize: 14 },
  list: { padding: Spacing.three, gap: Spacing.three },
  row: { flexDirection: 'row' },
  rowLeft: { justifyContent: 'flex-start' },
  rowRight: { justifyContent: 'flex-end' },
  bubbleWrap: { maxWidth: '88%' },
  bubble: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  action: {
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  actionText: { color: '#FFFFFF' },
  resolved: { marginTop: Spacing.two, fontSize: 12 },
  typing: { paddingVertical: Spacing.three, alignItems: 'flex-start' },
  composer: {
    padding: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  micError: { fontSize: 12, marginBottom: Spacing.two },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.one,
    borderWidth: 1,
    // Fully rounded: the row reads as one control, and a pill is a bigger,
    // more forgiving target than a rectangle for a thumb.
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  input: {
    flex: 1,
    minHeight: 40,
    // Grows with the text and then scrolls, so dictating three sentences
    // shows three sentences without pushing the buttons off the screen.
    maxHeight: 120,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  circle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { fontSize: 16, lineHeight: 20 },
  glyphOnColor: { color: '#FFFFFF', fontWeight: '700' },
  retry: {
    marginTop: Spacing.two,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  retryText: { fontWeight: '600', fontSize: 13 },
});
