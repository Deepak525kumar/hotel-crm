import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Badge, Button, Card, SectionHeader } from '@/components/ui';
import { DocumentChecklistRow } from '@/components/documents/DocumentChecklistRow';
import { ContractStatusCard } from '@/components/hr/ContractStatusCard';
import { buildChecklist, canSubmitForReview } from '@/lib/onboarding-checklist';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/lib/api';
import { translateApiError } from '@/lib/api-error-i18n';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ContractDto, DocumentCompleteness, WorkerDocument } from '@/types/api';

/**
 * Where a worker lands until their EmploymentRecord goes ACTIVE (ADR-065).
 *
 * This screen exists because of two related complaints. The app used to let a
 * PENDING worker straight into the tabs, where nothing worked and a
 * dismissible card was the only hint that onboarding was unfinished; and the
 * document upload -- the single thing standing between them and an active
 * account -- was buried behind Profile -> View documents, two taps from
 * anywhere and signposted nowhere.
 *
 * So the gate and the task live on the same screen: what is missing, the
 * upload control to fix it, and the submit button, in that order.
 */
export default function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const theme = useTheme();

  const [documents, setDocuments] = useState<WorkerDocument[]>([]);
  const [completeness, setCompleteness] = useState<DocumentCompleteness | null>(null);
  const [contract, setContract] = useState<ContractDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = user?.employment_status ?? 'PENDING';

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const [docs, comp, contractData] = await Promise.all([
        api.documents.list(user.id),
        api.documents.getCompleteness(user.id).catch(() => null),
        api.hr.getContractStatus(user.id).catch(() => null),
      ]);
      setDocuments(Array.isArray(docs) ? docs : []);
      setCompleteness(comp);
      setContract(contractData);
    } catch (e) {
      setError(translateApiError(e, t, 'documents.loadFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const onUploaded = useCallback(
    (doc: WorkerDocument) => {
      setDocuments((prev) => [doc, ...prev]);
      void load();
    },
    [load],
  );

  const submit = useCallback(async () => {
    if (!user) return;
    setSubmitting(true);
    try {
      // The lifecycle endpoints are keyed by the EmploymentRecord's
      // `employee_id` ("EMP-W-001"), not the user id, and /auth/me does not
      // return it -- so it has to be resolved first.
      const record = await api.employee.getByUserId(user.id);
      if (!record) {
        Alert.alert(t('errors.title'), t('onboarding.noEmploymentRecord'));
        return;
      }
      await api.employee.submitForReview(record.employee_id);
      Alert.alert(t('common.success'), t('onboarding.submittedForReview'));
      await load();
    } catch (e) {
      Alert.alert(t('errors.title'), translateApiError(e, t, 'errors.generic'));
    } finally {
      setSubmitting(false);
    }
  }, [user, t, load]);

  const checklist = buildChecklist(documents, completeness);
  const isComplete = canSubmitForReview(checklist, completeness);
  const remaining = checklist.filter((e) => e.document === null).length;

  // Only PENDING can act. The other gated statuses are terminal from the
  // worker's side -- telling a REJECTED worker to upload more documents would
  // be a lie, so they get an explanation and a way to reach someone instead.
  const canSubmit = status === 'PENDING';

  const statusCopy: Record<string, { tone: 'warning' | 'danger' | 'neutral'; body: string }> = {
    PENDING: { tone: 'warning', body: t('onboarding.statusPendingBody') },
    REJECTED: { tone: 'danger', body: t('onboarding.statusRejectedBody') },
    DEACTIVATED: { tone: 'neutral', body: t('onboarding.statusDeactivatedBody') },
    DELETED: { tone: 'neutral', body: t('onboarding.statusDeletedBody') },
  };
  const copy = statusCopy[status] ?? statusCopy.PENDING;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
        >
          <View style={styles.headerRow}>
            <ThemedText type="title">{t('onboarding.title')}</ThemedText>
            <Badge label={t(`onboarding.status${status}`)} tone={copy.tone} />
          </View>

          <ThemedText type="small" themeColor="textSecondary" style={styles.lead}>
            {copy.body}
          </ThemedText>

          {error ? (
            <Card>
              <ThemedText type="small" style={{ color: theme.danger }}>
                {error}
              </ThemedText>
              <Button label={t('common.retry')} variant="ghost" onPress={() => void load()} />
            </Card>
          ) : null}

          {canSubmit ? (
            <>
              <SectionHeader
                title={t('onboarding.checklistTitle')}
                subtitle={remaining === 0 ? t('onboarding.allUploaded') : t('onboarding.remainingCount', { count: remaining })}
              />
              {loading ? (
                <ActivityIndicator />
              ) : (
                <>
                  <Card>
                    {checklist.map((entry) =>
                      user ? (
                        <DocumentChecklistRow
                          key={entry.key}
                          entry={entry}
                          workerId={user.id}
                          onUploaded={onUploaded}
                        />
                      ) : null,
                    )}
                  </Card>
                  <SectionHeader title={t('hr.contract')} />
                  {user && (
                    <ContractStatusCard contract={contract} loading={loading} workerId={user.id} onUploadSuccess={load} />
                  )}
                </>
              )}

              <Button
                label={t('onboarding.submitForReview')}
                onPress={() => void submit()}
                loading={submitting}
                // Submitting with documents still missing wastes a manager
                // review cycle and bounces straight back to the worker.
                disabled={!isComplete}
                accessibilityHint={
                  isComplete ? undefined : t('onboarding.submitDisabledHint')
                }
                style={styles.submit}
              />
              {!isComplete ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                  {t('onboarding.submitDisabledHint')}
                </ThemedText>
              ) : null}
            </>
          ) : null}

          <View style={styles.footer}>
            <Button
              label={t('nav.settings')}
              variant="ghost"
              onPress={() => router.push('/settings')}
            />
            <Button label={t('nav.logout')} variant="ghost" onPress={() => void logout()} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  lead: { lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, marginTop: Spacing.one },
  submit: { marginTop: Spacing.two },
  hint: { textAlign: 'center' },
  footer: { marginTop: Spacing.four, gap: Spacing.one },
});
