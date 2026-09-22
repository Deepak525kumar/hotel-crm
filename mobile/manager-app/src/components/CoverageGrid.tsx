import { Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing, ThemedText, useTheme } from '@hotel-crm/mobile-shared';

export type DayCoverage = {
  day: string;
  placements: number;
  absences: number;
  /** False for days outside the month being shown. */
  inPeriod: boolean;
};

/**
 * Week and month at a glance.
 *
 * COUNTS AND A BAR, not placement tags. The web renders up to three stacked
 * name tags per day cell; at 375pt a month cell is about 50pt wide and a name
 * truncates to nothing, so the tag conveys less than the number would.
 *
 * What a supervisor actually scans a month for is "which days are thin" — so
 * the cell shows how many people are on, and an absence marker when someone
 * is off. Tapping drops into that day's agenda, where the names live.
 */
export function CoverageGrid({
  days,
  selected,
  columns = 7,
  onSelect,
  today,
}: {
  days: readonly DayCoverage[];
  selected: string;
  columns?: number;
  onSelect: (day: string) => void;
  today: string;
}) {
  const theme = useTheme();
  const busiest = Math.max(1, ...days.map((d) => d.placements));

  return (
    <View style={styles.grid}>
      {days.map((cell) => {
        const isSelected = cell.day === selected;
        const isToday = cell.day === today;
        // Relative to the busiest day in view, so a quiet week still shows
        // shape rather than a row of near-empty bars.
        const fill = cell.placements === 0 ? 0 : Math.max(0.15, cell.placements / busiest);

        return (
          <Pressable
            key={cell.day}
            onPress={() => onSelect(cell.day)}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`${cell.day}, ${cell.placements} placed${
              cell.absences > 0 ? `, ${cell.absences} absent` : ''
            }`}
            style={[
              styles.cell,
              { width: `${100 / columns}%` },
              !cell.inPeriod && styles.outside,
            ]}
          >
            <View
              style={[
                styles.inner,
                {
                  backgroundColor: isSelected ? theme.primarySubtle : theme.backgroundElement,
                  borderColor: isSelected ? theme.primary : theme.border,
                },
              ]}
            >
              <ThemedText
                type={isToday ? 'smallBold' : 'small'}
                themeColor={isToday ? 'primary' : 'text'}
              >
                {Number(cell.day.slice(8))}
              </ThemedText>

              <View style={[styles.bar, { backgroundColor: theme.backgroundSelected }]}>
                <View
                  style={[
                    styles.barFill,
                    { backgroundColor: theme.primary, width: `${Math.round(fill * 100)}%` },
                  ]}
                />
              </View>

              <View style={styles.meta}>
                <ThemedText type="small" themeColor="textSecondary">
                  {cell.placements || '·'}
                </ThemedText>
                {/* A dot, not a number: on a 50pt cell the fact that somebody
                    is off is the signal; how many is the day view's job. */}
                {cell.absences > 0 ? (
                  <View style={[styles.absent, { backgroundColor: theme.warning }]} />
                ) : null}
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { padding: 2 },
  outside: { opacity: 0.4 },
  inner: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.two,
    paddingHorizontal: 2,
    alignItems: 'center',
    gap: 3,
    minHeight: 62,
  },
  bar: { height: 3, width: '80%', borderRadius: Radius.full, overflow: 'hidden' },
  barFill: { height: 3, borderRadius: Radius.full },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  absent: { width: 5, height: 5, borderRadius: 3 },
});
