import { Pressable, StyleSheet, View } from 'react-native';

import { Radius, ThemedText, useTheme } from '@hotel-crm/mobile-shared';

/**
 * A segmented control.
 *
 * Replaces the horizontal date strip the project owner disliked: a row of
 * scrolling day chips gave no way to reach next month and no sense of where
 * you were. A segmented switcher is the platform-native way to say "the same
 * data, at three zoom levels", and it leaves the period label and arrows to
 * do the navigating.
 */
export function ViewSwitcher<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  const theme = useTheme();

  return (
    <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={[
              styles.segment,
              selected && { backgroundColor: theme.backgroundElement },
            ]}
          >
            <ThemedText
              type={selected ? 'smallBold' : 'small'}
              themeColor={selected ? 'text' : 'textSecondary'}
            >
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
  },
});
