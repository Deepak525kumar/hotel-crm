import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useChatbotStore } from '@/stores/chatbot-store';

/**
 * The floating assistant launcher.
 *
 * RENDERS NOTHING AT ALL when the backend does not serve the chatbot, which
 * is its state in production (`FEATURE_CHATBOT` is off, so every
 * `/chatbot/*` route 404s). The probe runs once per session and failure is
 * silent: a worker mid-shift must not find a button that errors when
 * pressed, and must not be shown that an unreleased feature exists.
 *
 * A BUTTON THAT NAVIGATES, not an overlay panel. The web widget opens a
 * panel over the page because a desktop viewport has room for both; a phone
 * does not, and a chat squeezed into a floating card would be worse than the
 * full screen it can have for free. This is the same capability in the shape
 * the platform actually affords.
 */
export function ChatLauncher() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { available, probe } = useChatbotStore();

  useEffect(() => {
    void probe();
  }, [probe]);

  if (available !== true) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('chatbot.title', 'Assistant')}
      onPress={() => router.push('/assistant')}
      style={[styles.fab, { backgroundColor: theme.primary }]}
    >
      {/* A word rather than an icon: the app ships in six languages including
          Arabic and Urdu, and a speech-bubble glyph reads as decoration to
          someone who has not seen this feature before. */}
      <ThemedText style={styles.label}>{t('chatbot.title', 'Assistant')}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: Spacing.three,
    // Clear of the home indicator and any bottom chrome.
    bottom: Spacing.five,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Radius.full,
    // Raised above the scrolling content it floats over.
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  label: { color: '#FFFFFF', fontWeight: '600' },
});
