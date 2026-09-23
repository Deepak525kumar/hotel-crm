import { Colors } from '@hotel-crm/mobile-shared';

/**
 * The resolved palette for one scheme.
 *
 * Both schemes, not just `light`: the two objects have identical keys but
 * different literal string types, so typing this as `typeof Colors.light`
 * rejects the dark palette at the call site — which would have meant this
 * function could only ever be called in light mode.
 */
type Palette = typeof Colors.light | typeof Colors.dark;

/**
 * react-native-calendars, wearing our palette.
 *
 * The kit ships its own light-only defaults (a blue accent, white surfaces,
 * its own greys). Adopting it without this would put a second, visibly
 * different design system inside the app, and dark mode would render black
 * text on a white calendar over a black screen.
 *
 * So every colour it exposes is mapped to a token from `theme.ts`. No hex
 * literal appears here, for the same reason no screen may hardcode one.
 *
 * `textDayFontFamily` and friends are deliberately left to the platform: the
 * apps load no custom font, and naming one here would either be ignored or
 * silently fall back, which looks like a bug on one platform only.
 */
export function calendarTheme(theme: Palette): Record<string, unknown> {
  return {
    backgroundColor: theme.background,
    calendarBackground: theme.background,

    // Month and weekday headers
    monthTextColor: theme.text,
    textMonthFontSize: 20,
    textMonthFontWeight: '600',
    textSectionTitleColor: theme.textSecondary,
    textDayHeaderFontSize: 12,
    textDayHeaderFontWeight: '600',

    // Days
    dayTextColor: theme.text,
    textDayFontSize: 16,
    textDisabledColor: theme.textSecondary,
    todayTextColor: theme.primary,
    todayButtonTextColor: theme.primary,

    // Selection. `selectedDayBackgroundColor` is a filled pill, so the text on
    // it must be onPrimary or it disappears against the accent.
    selectedDayBackgroundColor: theme.primary,
    selectedDayTextColor: theme.onPrimary,
    selectedDotColor: theme.onPrimary,

    // Dots under a day: a day's workload at a glance.
    dotColor: theme.primary,

    arrowColor: theme.primary,
    disabledArrowColor: theme.textSecondary,

    // The expand/collapse knob on ExpandableCalendar.
    expandableKnobColor: theme.border,

    // The agenda's own surfaces, so a section header does not arrive white.
    agendaDayTextColor: theme.textSecondary,
    agendaDayNumColor: theme.text,
    agendaTodayColor: theme.primary,
    agendaKnobColor: theme.border,

    // A hairline that matches every other divider in the app.
    lineColor: theme.border,
    separatorColor: theme.border,

    // Used by the kit's own "today" pill.
    todayBackgroundColor: theme.primarySubtle,

    stylesheet: {
      calendar: {
        header: {
          week: {
            marginTop: 4,
            marginBottom: 2,
            flexDirection: 'row',
            justifyContent: 'space-around',
          },
        },
      },
    },
    textDayStyle: { marginTop: 2 },
  };
}
