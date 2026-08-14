import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import type { ConsentNotice } from '@/types/api';

/**
 * Renders a fetched notice and the Grant/Decline decision — only shown once
 * a notice has actually been requested (ConsentStatusCard's "Review notice"
 * action). notice_content is confirmed plain text server-side, rendered
 * verbatim (no markdown/HTML parsing needed or attempted). RTL is applied
 * only to this text, not the screen/navigation.
 */
export function ConsentNoticeCard({
  notice,
  deciding,
  onDecide,
}: {
  notice: ConsentNotice;
  deciding: 'GRANTED' | 'DECLINED' | null;
  onDecide: (decision: 'GRANTED' | 'DECLINED') => void;
}) {
  const theme = useTheme();

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="small" themeColor="textSecondary">
        Notice version: {notice.notice_version}
      </ThemedText>
      <ThemedText
        type="small"
        style={notice.rtl ? styles.rtlText : undefined}
      >
        {notice.notice_content}
      </ThemedText>

      <ThemedView style={styles.row} type="backgroundElement">
        <Pressable
          onPress={() => onDecide('GRANTED')}
          disabled={deciding !== null}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.text, opacity: pressed || deciding !== null ? 0.7 : 1 },
          ]}
        >
          {deciding === 'GRANTED' ? (
            <ActivityIndicator color={theme.background} size="small" />
          ) : (
            <ThemedText type="small" style={{ color: theme.background }}>
              Grant
            </ThemedText>
          )}
        </Pressable>
        <Pressable
          onPress={() => onDecide('DECLINED')}
          disabled={deciding !== null}
          style={({ pressed }) => [
            styles.button,
            styles.declineButton,
            { borderColor: theme.backgroundSelected, opacity: pressed || deciding !== null ? 0.7 : 1 },
          ]}
        >
          {deciding === 'DECLINED' ? (
            <ActivityIndicator color={theme.text} size="small" />
          ) : (
            <ThemedText type="small">Decline</ThemedText>
          )}
        </Pressable>
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.two },
  rtlText: { writingDirection: 'rtl', textAlign: 'right' },
  row: { flexDirection: 'row', gap: Spacing.two },
  button: {
    flex: 1,
    height: 40,
    borderRadius: Spacing.two,
    justifyContent: 'center',
    alignItems: 'center',
  },
  declineButton: { backgroundColor: 'transparent', borderWidth: 1 },
});
