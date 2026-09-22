/**
 * The public surface of the shared mobile package.
 *
 * Consumed today by `mobile/manager-app` only. `worker-app` and `checker-app`
 * keep their own hand-maintained copies of these files, deliberately: they are
 * in production, and migrating two shipped apps is not a prerequisite for
 * starting a third (MANAGER_APP_PLAN.md D-2).
 *
 * That leaves three copies of the design system for now, which is a real cost
 * and is tracked as such. The locale catalogues are the part that cannot
 * drift silently -- `locales.test.ts` in each package deep-equals the
 * frontend's, so all four are pinned to one source. The code is not pinned
 * that way; MIGRATION.md lists every file here that has a twin, so the
 * eventual migration is a checklist rather than an archaeology exercise.
 */

// Design tokens and typography
export * from './constants/theme';
export * from './constants/polling';
export { ThemedText, type ThemedTextProps } from './components/themed-text';
export { ThemedView, type ThemedViewProps } from './components/themed-view';
export { RatingTierBadge } from './components/RatingTierBadge';
export { LanguagePicker } from './components/LanguagePicker';
export { ThemePicker } from './components/ThemePicker';

// Primitives that predate this package (copied verbatim from worker-app)
export * from './components/ui';

// Primitives this package adds, because a form- and list-heavy manager app
// cannot be built on the shipped set (it has no input, modal, toast or
// skeleton at all).
export * from './components/ui/input';
export * from './components/ui/bottom-sheet';
export * from './components/ui/select-sheet';
export * from './components/ui/skeleton';
export * from './components/ui/data-row';
export * from './components/ui/confirm-dialog';
export * from './components/ui/toast';
export * from './components/ui/filter-bar';
export * from './components/ui/progress-sheet';
export * from './components/ui/date-field';

// Hooks
export { useTheme } from './hooks/use-theme';
export { useColorScheme } from './hooks/use-color-scheme';

// Lib
export * from './lib/api';
export * from './lib/api-error-i18n';
export * from './lib/locales';
export * from './lib/scope';
export * from './lib/persistent-storage';

// Stores
export * from './stores/auth-store';
export * from './stores/theme-store';
export * from './stores/locale-store';
export * from './stores/consent-store';
export * from './stores/notification-store';
export * from './stores/chatbot-store';

// Types
export * from './types/api';
