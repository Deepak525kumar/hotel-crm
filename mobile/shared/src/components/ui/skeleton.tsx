import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Radius, Spacing } from '../../constants/theme';
import { useTheme } from '../../hooks/use-theme';

/**
 * A placeholder block, and the first consumer the `skeleton` colour token has
 * ever had -- it was defined in `theme.ts` for both schemes and then used by
 * nothing, because the two shipped apps show a bare `ActivityIndicator`.
 *
 * A spinner is fine for a home screen with three cards. It is poor for the
 * manager app's dense lists: the screen height collapses to nothing and then
 * snaps back, which on a slow hotel connection reads as a broken screen.
 *
 * No shimmer animation. It would need Reanimated in a package that otherwise
 * has no animation dependency, and a static block already communicates
 * "loading" once rows are the right size and shape.
 */
export function Skeleton({ height = 16, width, style }: { height?: number; width?: number | `${number}%`; style?: ViewStyle }) {
  const theme = useTheme();
  return (
    <View
      // Announced as one "Loading" element rather than a dozen empty views.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ height, width: width ?? '100%', backgroundColor: theme.skeleton, borderRadius: Radius.sm }, style]}
    />
  );
}

/** A list of skeleton rows shaped like `DataRow`, for a loading list screen. */
export function SkeletonList({ rows = 6 }: { rows?: number }) {
  const theme = useTheme();
  return (
    <View
      style={styles.list}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
    >
      {Array.from({ length: rows }, (_, i) => (
        <View
          key={i}
          style={[styles.row, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
        >
          <Skeleton height={16} width="60%" />
          <Skeleton height={12} width="40%" />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.two },
  row: {
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.three,
  },
});
