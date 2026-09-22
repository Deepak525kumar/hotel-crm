import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, ViewStyle } from 'react-native';

import { ThemedText } from '../themed-text';
import { Elevation, Radius, Spacing } from '../../constants/theme';
import { useTheme } from '../../hooks/use-theme';

/**
 * The worker app's shared UI primitives.
 *
 * Screens were previously assembled from raw `View`s with inline styles, which
 * is how five of them ended up hardcoding `#FFFFFF` card backgrounds (invisible
 * text in dark mode) and how no two screens agreed on card padding, radius or
 * shadow depth. Everything here reads its colours from `useTheme()`, so a
 * screen built out of these components is correct in both schemes by
 * construction.
 *
 * Deliberately small: one card, one button, one section header, one badge, one
 * stat tile, one empty state, one row. Add to it rather than restyling a
 * `View` in a screen.
 */

// ---------------------------------------------------------------- Card

export function Card({
  children,
  style,
  elevation = 'sm',
}: {
  children: ReactNode;
  style?: ViewStyle;
  elevation?: keyof typeof Elevation;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.border,
        },
        Elevation[elevation],
        style,
      ]}
    >
      {children}
    </View>
  );
}

// -------------------------------------------------------------- Button

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  accessibilityHint?: string;
}) {
  const theme = useTheme();

  const fills: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: theme.primary, fg: theme.onPrimary },
    secondary: { bg: theme.backgroundSelected, fg: theme.text },
    ghost: { bg: 'transparent', fg: theme.primary, border: theme.border },
    danger: { bg: theme.danger, fg: theme.onPrimary },
  };
  const fill = fills[variant];
  const isInactive = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isInactive}
      accessibilityRole="button"
      // Without this a screen reader announces nothing but the label, and a
      // disabled button still reads as tappable.
      accessibilityState={{ disabled: !!isInactive, busy: !!loading }}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: fill.bg,
          borderColor: fill.border ?? 'transparent',
          borderWidth: fill.border ? 1 : 0,
          opacity: isInactive ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fill.fg} />
      ) : (
        <ThemedText type="smallBold" style={{ color: fill.fg }}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

// ------------------------------------------------------- SectionHeader

/**
 * A screen's title row, with the notification bell on the right.
 *
 * Four screens had grown their own copy of this with slightly different
 * spacing and alignment, which is what made the app feel assembled rather
 * than designed.
 */
export function ScreenHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <View style={styles.screenHeader}>
      <View style={styles.sectionText}>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        ) : null}
        <ThemedText type="title">{title}</ThemedText>
      </View>
      {action}
    </View>
  );
}

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionText}>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
          {title.toUpperCase()}
        </ThemedText>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {action}
    </View>
  );
}

// --------------------------------------------------------------- Badge

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const theme = useTheme();
  const tones: Record<BadgeTone, { bg: string; fg: string }> = {
    neutral: { bg: theme.backgroundSelected, fg: theme.textSecondary },
    primary: { bg: theme.primarySubtle, fg: theme.primary },
    success: { bg: theme.successSubtle, fg: theme.success },
    warning: { bg: theme.warningSubtle, fg: theme.warning },
    danger: { bg: theme.dangerSubtle, fg: theme.danger },
  };
  const c = tones[tone];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <ThemedText type="small" style={{ color: c.fg, fontWeight: '600' }}>
        {label}
      </ThemedText>
    </View>
  );
}

// ------------------------------------------------------------ StatTile

export function StatTile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  tone?: BadgeTone;
}) {
  const theme = useTheme();
  const accents: Record<BadgeTone, string> = {
    neutral: theme.text,
    primary: theme.primary,
    success: theme.success,
    warning: theme.warning,
    danger: theme.danger,
  };
  return (
    <Card style={styles.statTile}>
      <ThemedText type="title" style={{ color: accents[tone] }}>
        {String(value)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
        {label}
      </ThemedText>
    </Card>
  );
}

// ---------------------------------------------------------- EmptyState

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <Card style={styles.empty}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {body ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyBody}>
          {body}
        </ThemedText>
      ) : null}
      {action}
    </Card>
  );
}

// ------------------------------------------------------------- ListRow

export function ListRow({
  title,
  subtitle,
  right,
  onPress,
  last,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  /** Last row in its card: drops the divider that would otherwise sit against
   *  the card's own edge. */
  last?: boolean;
}) {
  const theme = useTheme();
  const content = (
    <View
      style={[
        styles.row,
        { borderColor: theme.border },
        last ? styles.rowLast : null,
      ]}
    >
      <View style={styles.rowText}>
        <ThemedText type="smallBold">{title}</ThemedText>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {right}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  button: {
    minHeight: 48, // iOS HIG / Material minimum tap target.
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  sectionText: { flex: 1, gap: 2 },
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  sectionTitle: { letterSpacing: 0.6 },
  badge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radius.full,
    alignSelf: 'flex-start',
  },
  statTile: { flex: 1, minWidth: 96, gap: Spacing.half },
  empty: { alignItems: 'flex-start', gap: Spacing.two },
  emptyBody: { lineHeight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLast: { borderBottomWidth: 0 },
  rowText: { flex: 1, gap: Spacing.half },
});
