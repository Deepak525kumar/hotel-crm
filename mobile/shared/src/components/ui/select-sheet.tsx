import { Pressable, StyleSheet, View } from 'react-native';
import { useState } from 'react';

import { BottomSheet } from './bottom-sheet';
import { ThemedText } from '../themed-text';
import { Radius, Spacing } from '../../constants/theme';
import { useTheme } from '../../hooks/use-theme';

export type SelectOption<T extends string> = { value: T; label: string; hint?: string };

/**
 * A single-choice picker rendered as a sheet of rows.
 *
 * Deliberately NOT the platform picker: iOS renders a spinning wheel and
 * Android a dropdown, so the same filter looks and behaves differently on the
 * two platforms, and the wheel in particular hides every option but three.
 * A manager filtering by one of six statuses should see six rows.
 */
export function SelectSheet<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select',
  disabled,
}: {
  label?: string;
  value: T | null;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View style={styles.wrap}>
      {label ? (
        <ThemedText type="smallBold" themeColor="textSecondary">
          {label}
        </ThemedText>
      ) : null}

      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}: ${selected?.label ?? placeholder}` : placeholder}
        accessibilityState={{ disabled: !!disabled, expanded: open }}
        style={[
          styles.trigger,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          disabled ? styles.disabled : null,
        ]}
      >
        <ThemedText themeColor={selected ? 'text' : 'textSecondary'} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </ThemedText>
      </Pressable>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title={label}>
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              onPress={() => {
                onChange(option.value);
                setOpen(false);
              }}
              style={[
                styles.option,
                {
                  backgroundColor: isSelected ? theme.primarySubtle : theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            >
              <ThemedText type={isSelected ? 'smallBold' : 'default'}>{option.label}</ThemedText>
              {option.hint ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {option.hint}
                </ThemedText>
              ) : null}
            </Pressable>
          );
        })}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  trigger: {
    minHeight: 48,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
  },
  disabled: { opacity: 0.5 },
  option: {
    minHeight: 48,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
});
