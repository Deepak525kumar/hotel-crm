import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';
import { Radius, Spacing } from '../../constants/theme';
import { useTheme } from '../../hooks/use-theme';

/**
 * A tappable date control.
 *
 * The date itself is carried as a plain `YYYY-MM-DD` string, never a `Date`.
 * That is the single most expensive lesson in this codebase's calendar code:
 * "today" is Europe/Berlin (`CALENDAR_TIMEZONE`), and a `Date` built from a
 * date-only string is midnight UTC, so a night-shift manager in Berlin is
 * handed yesterday. Keeping the value as the string the API already speaks
 * means no timezone conversion can happen by accident in between.
 *
 * Rendering of the actual picker is left to the caller via `onPress` so this
 * package takes no dependency on a picker library; the app supplies one.
 */
export function DateField({
  label,
  value,
  placeholder = 'Select a date',
  onPress,
  disabled,
  error,
}: {
  label?: string;
  /** `YYYY-MM-DD`, or null when unset. Never a Date -- see the block comment. */
  value: string | null;
  placeholder?: string;
  onPress: () => void;
  disabled?: boolean;
  error?: string;
}) {
  const theme = useTheme();

  return (
    <View style={styles.wrap}>
      {label ? (
        <ThemedText type="smallBold" themeColor="textSecondary">
          {label}
        </ThemedText>
      ) : null}
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}: ${value ?? placeholder}` : (value ?? placeholder)}
        accessibilityState={{ disabled: !!disabled }}
        style={[
          styles.field,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: error ? theme.danger : theme.border,
          },
          disabled ? styles.disabled : null,
        ]}
      >
        <ThemedText themeColor={value ? 'text' : 'textSecondary'}>{value ?? placeholder}</ThemedText>
      </Pressable>
      {error ? (
        <ThemedText type="small" themeColor="danger">
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  field: {
    minHeight: 48,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
  },
  disabled: { opacity: 0.5 },
});
