import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, Radius, Spacing, ThemedText, useTheme } from '@hotel-crm/mobile-shared';

/**
 * One thing waiting for the manager, and a way straight into it.
 *
 * Rendered ONLY when the count is non-zero. A dashboard full of zeroes
 * teaches people to stop reading it, and "nothing is waiting" is better said
 * by the section being empty than by six rows of 0.
 */
export function ActionCard({
  label,
  count,
  urgent,
  onPress,
}: {
  label: string;
  count: number;
  urgent?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  if (count === 0) return null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${count}`}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: urgent ? theme.warning : theme.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.text}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {label}
        </ThemedText>
      </View>
      <Badge label={String(count)} tone={urgent ? 'warning' : 'neutral'} />
      <ThemedText themeColor="textSecondary">›</ThemedText>
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
  text: { flex: 1, flexShrink: 1, minWidth: 0 },
});
