import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ThemedText , Radius, Spacing , useTheme , useChatbotStore } from '@hotel-crm/mobile-shared';

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
      accessibilityLabel={t('chatbot.title', 'Zelle')}
      onPress={() => router.push('/assistant')}
      style={[styles.fab, { backgroundColor: theme.primary }]}
    >
      {/* A MARK AND A NAME, not one or the other.
          
          This was the word "Assistant" alone, on the reasoning that a
          speech-bubble glyph reads as decoration to someone who has not seen
          the feature -- which was right about the glyph and wrong about the
          word. "Assistant" is a category, and the assistant has a name:
          Zelle. A name is the one label that needs no translation, so it
          serves ar/ur/uk exactly as well as en, and it is what someone is
          told to look for when a colleague says "ask Zelle".

          The badge is a circle with a Z, built from a View and Text rather
          than an SVG: these apps ship no vector library (no react-native-svg,
          no vector-icons), and adding one to draw a 20px circle would be a
          dependency for a shape the layout engine already draws. */}
      <View style={[styles.badge, { borderColor: '#FFFFFF' }]}>
        <ThemedText style={styles.badgeLetter}>Z</ThemedText>
      </View>
      <ThemedText style={styles.label}>{t('chatbot.title', 'Zelle')}</ThemedText>
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
    // The badge sits beside the name rather than above it: a pill is easier
    // to hit one-handed than a tall stack, and these users are mid-shift.
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    // Raised above the scrolling content it floats over.
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  label: { color: '#FFFFFF', fontWeight: '600' },
  badge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Nudged up a hair: a capital Z sits low in its line box, and centring the
  // box is not the same as centring the letter.
  badgeLetter: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
    lineHeight: 15,
  },
});
