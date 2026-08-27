import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ConsentNoticeCard } from '@/components/consent/ConsentNoticeCard';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, setOnConsentRequired } from '@/lib/api';
import { translateApiError } from '@/lib/api-error-i18n';
import { DAILY_ACCESS_GATE_INSTANCE } from '@/types/api';
import { shouldBypassConsentGate } from '@/lib/consent-gate-decision';
import type { ConsentNotice, ConsentStatus } from '@/types/api';
import { useAuthStore } from '@/stores/auth-store';
import { useConsentRevisionStore } from '@/stores/consent-store';

/**
 * RULE-CONSENT-01 daily access gate, client half.
 *
 * The server is the real gate (middleware/consentGate.ts returns 403
 * CONSENT_REQUIRED on every non-exempt route). This component exists so the
 * worker sees the notice instead of a wall of failed requests -- it is UX for
 * an enforcement that happens server-side, not the enforcement itself. A
 * modified client that skipped this would still be refused by the API.
 *
 * Renders children only once today's consent is granted. Admins are never
 * gated, matching the server's own exemption.
 *
 * On a decline the worker sees a locked screen that still offers acceptance:
 * RULE-CONSENT-02 makes a later GRANT supersede the decline, so a mis-tap
 * must not cost someone their working day.
 */
export function ConsentGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const user = useAuthStore((s) => s.user);
  // Bumped by any in-app action that can change consent server-side (currently
  // withdrawal, from the consent screen). Without this the gate never learns
  // about a withdrawal the worker performed themselves -- see consent-store.
  const consentRevision = useConsentRevisionStore((s) => s.revision);

  const [status, setStatus] = useState<ConsentStatus | null>(null);
  const [notice, setNotice] = useState<ConsentNotice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusUnknown, setStatusUnknown] = useState(false);
  const [enforced, setEnforced] = useState(true);
  const [deciding, setDeciding] = useState<'GRANTED' | 'DECLINED' | null>(null);
  // Which calendar day the current `status` was read on, for the rollover check.
  const dayRef = useRef(new Date().toDateString());
  // Whose consent `status` describes. The bypass check below runs BEFORE the
  // loading branch, so a cached `granted` from the previous account would let
  // the next worker straight into the app for the duration of the refetch.
  const statusUserRef = useRef<string | null>(user?.id ?? null);

  const isAdmin = user?.role === 'admin';

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    // A re-check triggered in the background must not flash a full-screen
    // spinner over a screen the worker is already using.
    if (!opts?.silent) setLoading(true);
    setError(null);
    setStatusUnknown(false);
    try {
      // Ask whether the gate is enforced for this caller BEFORE deciding to
      // block. If FEATURE_CONSENT_GATE was turned off, the API has already
      // stopped gating and this screen must not keep prompting.
      // Best-effort: a failure here leaves `enforced` at its safe default of
      // true, so the gate still shows and consent still works.
      try {
        const g = await api.consent.getGateState();
        setEnforced(g.enforced);
        if (!g.enforced) return;
      } catch {
        // keep the default
      }

      const s = await api.consent.getStatus(DAILY_ACCESS_GATE_INSTANCE);
      setStatus(s);
      // Pre-fetch the notice whenever consent is not already granted, so the
      // worker lands directly on readable text rather than an extra tap. The
      // server serves it in their preferred language (ADR-068).
      if (s.status !== 'granted') {
        try {
          setNotice(await api.consent.requestNotice(DAILY_ACCESS_GATE_INSTANCE));
        } catch (e) {
          // Status IS known and says we are gated -- only the notice text
          // failed. Keep the wall (with a retry) rather than failing open:
          // this is not uncertainty about consent, it is a missing document.
          setError(translateApiError(e, t, 'consent.gateLoadFailed'));
        }
      }
    } catch (e) {
      // The STATUS call itself failed, so consent state is unknown. Fail open
      // -- see the render branch below for why.
      setStatusUnknown(true);
      setError(translateApiError(e, t, 'consent.gateLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!user || isAdmin) {
      setLoading(false);
      return;
    }
    // Drop the previous account's answer before asking about this one. Only on
    // a user CHANGE -- clearing it on every silent recheck would flash the
    // wall at a worker whose consent is perfectly valid.
    if (statusUserRef.current !== user.id) {
      statusUserRef.current = user.id;
      setStatus(null);
      setNotice(null);
      setStatusUnknown(false);
    }
    void load();
  }, [user, isAdmin, load, consentRevision]);

  // A consent read is only ever a snapshot, and this component used to take
  // exactly one, at mount. Three things can invalidate it while the app stays
  // open, and each gets a trigger below. Without them a worker whose consent
  // was withdrawn kept a working UI until the app was force-quit -- the API
  // was already refusing their calls, so the screen was lying to them.

  // 1. The API refused a call with CONSENT_REQUIRED. This is the authoritative
  //    signal: the server has decided, so re-read rather than trusting state.
  //    `silent` keeps the full-screen spinner away -- the gate is being
  //    re-checked underneath a UI the worker is still looking at.
  useEffect(() => {
    if (!user || isAdmin) return;
    setOnConsentRequired(() => void load({ silent: true }));
    return () => setOnConsentRequired(null);
  }, [user, isAdmin, load]);

  // 2. The app came back to the foreground. Covers consent withdrawn on
  //    another device (or on the web) while this one sat backgrounded, before
  //    the worker touches anything that would issue a request.
  useEffect(() => {
    if (!user || isAdmin) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void load({ silent: true });
    });
    return () => sub.remove();
  }, [user, isAdmin, load]);

  // 3. Midnight passed with the app open. The gate is a DAILY one, so
  //    yesterday's grant does not carry over -- an overnight shift would
  //    otherwise never be re-prompted. Checked on a coarse interval rather
  //    than a scheduled timer: the cost is one comparison a minute, and a
  //    timer set for midnight does not survive the device sleeping through it.
  useEffect(() => {
    if (!user || isAdmin) return;
    const id = setInterval(() => {
      const today = new Date().toDateString();
      if (dayRef.current !== today) {
        dayRef.current = today;
        void load({ silent: true });
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [user, isAdmin, load]);

  const decide = useCallback(
    async (decision: 'GRANTED' | 'DECLINED') => {
      if (!notice) return;
      setDeciding(decision);
      setError(null);
      try {
        await api.consent.recordDecision({
          consent_instance: DAILY_ACCESS_GATE_INSTANCE,
          decision,
          notice_version: notice.notice_version,
        });
        // Re-read rather than assuming: the server decides what today's
        // status is, and a stale-version decision is rejected server-side.
        setStatus(await api.consent.getStatus(DAILY_ACCESS_GATE_INSTANCE));
      } catch (e) {
        setError(translateApiError(e, t, 'consent.couldNotRecordDecision'));
      } finally {
        setDeciding(null);
      }
    },
    [notice, t],
  );

  // Admin, or consent already granted today -> the app proceeds untouched.
  //
  // `statusUnknown` fails OPEN, and the distinction matters: it is set only
  // when the /consent/status call itself failed, so the client has no idea
  // whether consent is required. Blocking on a guess is the wrong default
  // here for two reasons. The server is the real gate and still refuses every
  // gated call, so this is not a bypass -- it degrades to the pre-gate
  // experience (visible request failures) rather than a wall. And it is the
  // only thing that lets the documented kill switch reach the UI: when
  // FEATURE_CONSENT_GATE is turned off during an incident, the API stops
  // gating immediately, but a client that walls on its own consent read would
  // keep every non-admin staring at a notice they no longer need to accept --
  // and if the consent endpoints are what broke (the likely reason for
  // pulling the switch), that wall cannot be dismissed at all.
  //
  // This block previously claimed to fail open and did not: on an error
  // `status` stayed null and `loading` went false, so it fell through to the
  // wall below.
  if (!user) return <>{children}</>;
  if (shouldBypassConsentGate({ isAdmin, status, statusUnknown, enforced })) return <>{children}</>;

  if (loading) {
    return (
      <SafeAreaView style={[styles.centre, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.text} />
      </SafeAreaView>
    );
  }

  const declined = status?.status === 'declined';

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="subtitle" style={styles.header}>
          {declined ? t('consent.lockedTitle') : t('consent.gateTitle')}
        </ThemedText>

        <ThemedText type="small" themeColor="textSecondary" style={styles.body}>
          {declined ? t('consent.lockedBody') : t('consent.gateBody')}
        </ThemedText>

        {error ? (
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="small" style={{ color: theme.danger }}>
              {error}
            </ThemedText>
            <Pressable onPress={() => void load()} style={styles.retry}>
              <ThemedText type="smallBold">{t('consent.gateRetry')}</ThemedText>
            </Pressable>
          </ThemedView>
        ) : null}

        {notice ? (
          <ConsentNoticeCard notice={notice} deciding={deciding} onDecide={decide} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.two, gap: Spacing.two },
  header: { marginTop: Spacing.two },
  body: { marginBottom: Spacing.one },
  card: { padding: Spacing.two, borderRadius: Spacing.two, gap: Spacing.one },
  retry: { paddingVertical: Spacing.one },
});
