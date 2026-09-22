import { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';
import { Radius, Spacing } from '../../constants/theme';
import { useTheme } from '../../hooks/use-theme';

/**
 * The table replacement.
 *
 * Every list on the web portal is a `<table>` with no card fallback -- users
 * is four columns plus three filters, attendance five plus two, requests six.
 * None of that reflows to 375pt, so the manager app renders one card per row:
 * primary line, secondary line, trailing badge, chevron.
 *
 * `flexShrink: 1` on the text column and `numberOfLines` on both lines are
 * load-bearing, not tidiness. The web app learned the same lesson from the
 * other side (frontend/CLAUDE.md): a row whose content cannot shrink pushes
 * the layout wider than the viewport, and anything pinned to the right edge
 * lands off-screen. A long hotel name is exactly that content.
 */
export function DataRow({
  title,
  subtitle,
  meta,
  trailing,
  onPress,
  accessibilityHint,
}: {
  title: string;
  subtitle?: string;
  meta?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  accessibilityHint?: string;
}) {
  const theme = useTheme();

  const body = (
    <View style={[styles.row, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={styles.text}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {subtitle}
          </ThemedText>
        ) : null}
        {meta ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {meta}
          </ThemedText>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [pressed ? styles.pressed : null]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.three,
    minHeight: 48,
  },
  // Both of these matter: without min-width 0 on a flex child, `numberOfLines`
  // has nothing to truncate against and the row grows instead of ellipsising.
  text: { flex: 1, flexShrink: 1, minWidth: 0, gap: 2 },
  trailing: { flexShrink: 0 },
  pressed: { opacity: 0.85 },
});
