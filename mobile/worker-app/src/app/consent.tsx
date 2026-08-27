import { StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { ConsentStatusCard } from '@/components/consent/ConsentStatusCard';
import { ConsentNoticeCard } from '@/components/consent/ConsentNoticeCard';
import { DAILY_ACCESS_GATE_INSTANCE } from '@/types/api';
import type { ConsentNotice, ConsentStatus } from '@/types/api';
import { useTranslation } from 'react-i18next';
import { BackLink } from '@/components/BackLink';
import { translateApiError } from '../lib/api-error-i18n';
import { useConsentRevisionStore } from '@/stores/consent-store';
import { useTheme } from '@/hooks/use-theme';

/**
 * Self-service record/decision surface, not an access-blocking wall — no
 * route in the backend enforces this decision (ConsentService's own "Out of
 * Scope" note: the caller enforces the block, and nothing in this app does),
 * matching the identical posture frontend/components/consent/ConsentCard.tsx
 * already established. Only the daily-access-gate instance is surfaced.
 *
 * No optimistic cache updates (mobile has no SWR) — every action awaits the
 * API, then replaces local state from the real response, so state can never
 * drift from what the server actually recorded.
 */
export default function ConsentScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const [status, setStatus] = useState<ConsentStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [notice, setNotice] = useState<ConsentNotice | null>(null);
  const [fetchingNotice, setFetchingNotice] = useState(false);

  const [deciding, setDeciding] = useState<'GRANTED' | 'DECLINED' | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setStatusError(null);
    try {
      const result = await api.consent.getStatus(DAILY_ACCESS_GATE_INSTANCE);
      setStatus(result);
    } catch (error) {
      setStatusError(translateApiError(error, t, 'consent.couldNotLoadStatus'));
    } finally {
      setStatusLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const onReviewNotice = useCallback(async () => {
    setActionError(null);
    setFetchingNotice(true);
    try {
      const result = await api.consent.requestNotice(DAILY_ACCESS_GATE_INSTANCE);
      setNotice(result);
    } catch (error) {
      setActionError(translateApiError(error, t, 'consent.couldNotLoadNotice'));
    } finally {
      setFetchingNotice(false);
    }
  }, [t]);

  const onDecide = useCallback(
    async (decision: 'GRANTED' | 'DECLINED') => {
      if (!notice) return;
      setActionError(null);
      setDeciding(decision);
      try {
        const record = await api.consent.recordDecision({
          consent_instance: DAILY_ACCESS_GATE_INSTANCE,
          decision,
          notice_version: notice.notice_version,
        });
        setNotice(null);
        setStatus(
          record.decision === 'GRANTED'
            ? { status: 'granted', notice_version: record.notice_version, decided_at: record.decided_at }
            : { status: 'declined', notice_version: record.notice_version, decided_at: record.decided_at }
        );
      } catch (error) {
        setActionError(translateApiError(error, t, 'consent.couldNotRecordDecision'));
      } finally {
        setDeciding(null);
      }
    },
    [notice, t]
  );

  const onWithdraw = useCallback(async () => {
    setActionError(null);
    setWithdrawing(true);
    try {
      // withdrawConsent() has exactly one code path and always produces a
      // WITHDRAWN record on success (backend consent/service.ts:198-205,
      // hardcoded, no branch) — branching on the response here would defend
      // against a state the contract cannot produce. The await itself is
      // still the confirmation: a thrown error skips this line entirely and
      // is handled in the catch block below, so status is never set ahead
      // of the server actually confirming the withdrawal.
      await api.consent.withdraw(DAILY_ACCESS_GATE_INSTANCE);
      setStatus({ status: 'absent' });
      // Tell ConsentGate to re-read. Setting local state above only updates
      // THIS screen -- the gate keeps its own copy, and none of its three
      // re-check triggers (CONSENT_REQUIRED response, AppState -> active,
      // midnight rollover) fire for a withdrawal the worker just performed
      // here. Without this the app stayed fully usable until it was
      // force-quit, while the server was already refusing every gated call.
      useConsentRevisionStore.getState().invalidate();
    } catch (error) {
      setActionError(translateApiError(error, t, 'consent.couldNotWithdraw'));
    } finally {
      setWithdrawing(false);
    }
    // `t` was missing from these deps, so the failure message was captured
    // from the render at mount and would not follow a language change.
  }, [t]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <BackLink />
        <ThemedText type="subtitle" style={styles.header}>{t("consent.title")}</ThemedText>

        <ConsentStatusCard
          status={status}
          loading={statusLoading}
          error={statusError}
          onReviewNotice={onReviewNotice}
          onWithdraw={onWithdraw}
          withdrawing={withdrawing}
        />

        {fetchingNotice && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.loadingNotice}>
            Loading notice…
          </ThemedText>
        )}

        {notice && (
          <ConsentNoticeCard notice={notice} deciding={deciding} onDecide={onDecide} />
        )}

        {actionError && (
          <ThemedText type="small" style={[styles.errorText, { color: theme.danger }]}>
            {actionError}
          </ThemedText>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, paddingTop: Spacing.four },
  back: { marginBottom: Spacing.two },
  header: { marginBottom: Spacing.three },
  loadingNotice: { marginBottom: Spacing.two },
  errorText: { marginTop: Spacing.two },
});
