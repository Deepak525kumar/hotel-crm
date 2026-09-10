import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BackLink } from '@/components/BackLink';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useChatbotStore, type ChatMessage } from '@/stores/chatbot-store';

/**
 * The assistant screen.
 *
 * REDIRECTS AWAY when the backend does not serve the chatbot, which is its
 * state in production (`FEATURE_CHATBOT` is off). A route that resolves to a
 * dead screen is worse than one that does not resolve, and rendering an
 * empty shell would confirm an unreleased feature exists.
 */
export default function AssistantScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { available, probe, messages, commands, sending, send, runCommand, confirm, cancelConfirmation } =
    useChatbotStore();
  const [draft, setDraft] = useState('');
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
          <BackLink />
          <ThemedText type="subtitle">{t('chatbot.title', 'Zelle')}</ThemedText>
        </View>

        {messages.length === 0 ? (
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

        <View style={[styles.composer, { borderTopColor: theme.border, backgroundColor: theme.backgroundElement }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t('chatbot.placeholder', 'Ask about your shifts, contract or messages…')}
            placeholderTextColor={theme.textSecondary}
            accessibilityLabel={t('chatbot.inputLabel', 'Message')}
            multiline
            style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.background }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('chatbot.send', 'Send')}
            disabled={sending || draft.trim().length === 0}
            onPress={submit}
            style={[
              styles.send,
              { backgroundColor: draft.trim().length === 0 || sending ? theme.border : theme.primary },
            ]}
          >
            <ThemedText style={styles.sendText}>{t('chatbot.send', 'Send')}</ThemedText>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Bubble({
  message,
  onConfirm,
  onCancel,
}: {
  message: ChatMessage;
  onConfirm: () => void;
  onCancel: () => void;
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
        </ThemedView>

        {/* NOTHING HAS BEEN WRITTEN when this renders — the assistant has only
            proposed. The summary above comes from the server, rendered from
            the exact arguments the confirmation token authorises, so what a
            person reads is what runs. */}
        {message.pendingConfirmation ? (
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
    gap: Spacing.three,
    padding: Spacing.three,
  },
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
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    padding: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  send: {
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    height: 44,
    justifyContent: 'center',
  },
  sendText: { color: '#FFFFFF', fontWeight: '600' },
});
