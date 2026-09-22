import { ReactNode } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';

import { ThemedText } from '../themed-text';
import { Radius, Spacing } from '../../constants/theme';
import { useTheme } from '../../hooks/use-theme';

/**
 * The text field the two shipped apps never had.
 *
 * worker-app and checker-app style every `TextInput` inline at its call site,
 * which was survivable while the only forms were login and a rating note. A
 * manager app is form-heavy -- work requests, broadcasts, user creation, shift
 * summaries, every filter -- so the same eight lines of border/padding/colour
 * would be repeated dozens of times and drift.
 *
 * `autoCapitalize`/`autoCorrect`/`spellCheck` default OFF, which is the
 * opposite of React Native's defaults. That is deliberate and comes from a
 * real defect: iOS silently uppercases the first character of a password (see
 * worker-app `(auth)/login.tsx`), which produced "wrong credentials" for a
 * correctly-typed password with nothing visible on screen to explain it. A
 * field that wants sentence case must now ask for it, because the failure
 * mode of the wrong default is invisible.
 */
export function Input({
  label,
  error,
  hint,
  trailing,
  containerStyle,
  ...rest
}: TextInputProps & {
  label?: string;
  error?: string;
  hint?: string;
  trailing?: ReactNode;
  containerStyle?: ViewStyle;
}) {
  const theme = useTheme();

  return (
    <View style={[styles.wrap, containerStyle]}>
      {label ? (
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>
          {label}
        </ThemedText>
      ) : null}

      <View
        style={[
          styles.field,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: error ? theme.danger : theme.border,
          },
        ]}
      >
        <TextInput
          // See the block comment: these three defaults exist because the
          // platform's own defaults have already cost this project a login bug.
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          placeholderTextColor={theme.textSecondary}
          // A screen reader otherwise announces the value with no idea what it
          // is for; the visible label is a sibling View, not part of the input.
          accessibilityLabel={rest.accessibilityLabel ?? label}
          {...rest}
          style={[styles.input, { color: theme.text }, rest.style]}
        />
        {trailing}
      </View>

      {error ? (
        <ThemedText type="small" themeColor="danger" style={styles.foot}>
          {error}
        </ThemedText>
      ) : hint ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.foot}>
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  label: {},
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
  },
  input: {
    flex: 1,
    // 48 matches Button's minHeight, so a field and a button in the same row
    // line up and both clear the 44pt touch-target floor.
    minHeight: 48,
    fontSize: 16,
  },
  foot: {},
});
