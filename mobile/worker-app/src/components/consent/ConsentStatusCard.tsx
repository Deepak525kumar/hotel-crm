import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { statusAction, statusDescription, statusLabelKey } from '@/lib/consent-status';
import type { ConsentStatus } from '@/types/api';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/use-theme';

// Colocated with the component that renders it, matching this app's existing
// convention for status-color maps (e.g. shifts.tsx's STATUS_COLOR,
// absences.tsx's KIND_COLOR) — the theme only defines neutral tokens
// (text/background/backgroundElement/backgroundSelected/textSecondary), no
// semantic success/error/warning tokens exist yet, so every status color in
// this app is a local, colocated hex map like this one, not a shared lib
// function.
const STATUS_TONE: Record<ConsentStatus['status'], 'success' | 'danger' | 'warning'> = {
  // Theme tokens, resolved at render: the previous trio was light-mode only
  // and matched neither the badges elsewhere nor the accent.
  granted: 'success',
  declined: 'danger',
  absent: 'warning',
};

/**
 * Renders the current daily-access-gate status and the one action valid for
 * that status: Review notice (absent/declined) or Withdraw (granted). Never
 * presents an action that doesn't make sense for the current status — the
 * status determines the button, not the other way around.
 */
export function ConsentStatusCard({
  status,
  loading,
  error,
  onReviewNotice,
  onWithdraw,
  withdrawing,
}: {
  status: ConsentStatus | null;
  loading: boolean;
  error: string | null;
  onReviewNotice: () => void;
  onWithdraw: () => void;
  withdrawing: boolean;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  if (loading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  if (error || !status) {
    return (
      <ThemedText type="small" style={[styles.errorText, { color: theme.danger }]}>
        {error ?? t('consent.loadFailed')}
      </ThemedText>
    );
  }

  const description = statusDescription(status);
  const action = statusAction(status);

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedView style={styles.row} type="backgroundElement">
        <ThemedView style={styles.info} type="backgroundElement">
          <ThemedText type="smallBold" style={{ color: theme[STATUS_TONE[status.status]] }}>
            {t(statusLabelKey(status))}
          </ThemedText>
          {description && (
            <ThemedText type="small" themeColor="textSecondary">
              {t(description.key, description.values)}
            </ThemedText>
          )}
        </ThemedView>

        {action === 'withdraw' ? (
          <Pressable onPress={onWithdraw} disabled={withdrawing}>
            {withdrawing ? (
              <ActivityIndicator size="small" />
            ) : (
              <ThemedText type="linkPrimary">{t('consent.withdraw')}</ThemedText>
            )}
          </Pressable>
        ) : (
          <Pressable onPress={onReviewNotice}>
            <ThemedText type="linkPrimary">
              {action === 'review-again' ? t('consent.reviewAgain') : t('consent.reviewNotice')}
            </ThemedText>
          </Pressable>
        )}
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  loader: { marginTop: Spacing.six },
  card: { borderRadius: Spacing.two, padding: Spacing.three, marginBottom: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  info: { flex: 1, gap: 2 },
  errorText: {},
});
