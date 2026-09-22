import { Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing, ThemedText, useTheme } from '@hotel-crm/mobile-shared';

/**
 * The period label, with a step either side and a way back to today.
 *
 * "Today" is a button rather than a gesture because getting lost is the
 * commonest thing that happens in a calendar you can page through
 * indefinitely, and the way back should not be a secret.
 */
export function PeriodNav({
  label,
  onPrev,
  onNext,
  onToday,
  todayLabel,
  atToday,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  todayLabel: string;
  atToday: boolean;
}) {
  const theme = useTheme();

  const arrow = (dir: 'prev' | 'next', onPress: () => void) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={dir === 'prev' ? 'Previous' : 'Next'}
      style={[styles.arrow, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
    >
      <ThemedText type="smallBold">{dir === 'prev' ? '‹' : '›'}</ThemedText>
    </Pressable>
  );

  return (
    <View style={styles.row}>
      {arrow('prev', onPrev)}
      <View style={styles.label}>
        <ThemedText type="h2" numberOfLines={1}>
          {label}
        </ThemedText>
      </View>
      {/* Hidden when it would do nothing, so the control never lies about
          being actionable. */}
      {atToday ? null : (
        <Pressable
          onPress={onToday}
          accessibilityRole="button"
          style={[styles.today, { borderColor: theme.primary }]}
        >
          <ThemedText type="small" themeColor="primary">
            {todayLabel}
          </ThemedText>
        </Pressable>
      )}
      {arrow('next', onNext)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  label: { flex: 1, flexShrink: 1, minWidth: 0 },
  arrow: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  today: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.full,
  },
});
