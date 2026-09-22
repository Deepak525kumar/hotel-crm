import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import {
  Badge,
  ConfirmDialog,
  DataRow,
  EmptyState,
  MaxContentWidth,
  ScreenHeader,
  SkeletonList,
  Spacing,
  ThemedView,
  api,
  translateApiError,
  useToast,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';

/**
 * Payslip requests, and fulfilling them.
 *
 * SCOPE NOTE: this endpoint admits worker and checker as well as the three
 * manager roles, gated by `requirePayslipReadAccess()` — a worker sees only
 * their own. Fulfilling is manager-and-up and is refused across groups. This
 * screen never filters by hand to achieve that; the server does.
 *
 * The module tracks REQUESTS and their fulfilment status only. There is no
 * payroll computation and no payslip content anywhere in this product, so a
 * "fulfilled" row means someone sent the document by their own means — not
 * that the system produced one.
 */
export default function Payslips() {
  const { t } = useTranslation();
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [fulfilling, setFulfilling] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, error, isLoading, mutate } = useSWR('hr/payroll', () => api.hr.listPayroll());

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await mutate();
    } finally {
      setRefreshing(false);
    }
  }, [mutate]);

  const rows = data ?? [];

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
          }
        >
          <BackLink />
          <ScreenHeader title={t('hr.payslipRequests')} />

          {isLoading ? (
            <SkeletonList rows={6} />
          ) : error ? (
            <EmptyState title={t('common.loadFailed')} />
          ) : rows.length === 0 ? (
            <EmptyState title={t('hr.noPayslipRequests')} />
          ) : (
            rows.map((row) => (
              <DataRow
                key={row.id}
                title={`${row.period_start} – ${row.period_end}`}
                subtitle={row.worker_id}
                trailing={
                  <Badge
                    label={row.status}
                    tone={row.status === 'FULFILLED' ? 'success' : 'warning'}
                  />
                }
                onPress={
                  row.status === 'FULFILLED' ? undefined : () => setFulfilling(row.id)
                }
              />
            ))
          )}
        </ScrollView>

        <ConfirmDialog
          visible={fulfilling !== null}
          title={t('hr.markFulfilledAction')}
          // Deliberately explicit: marking fulfilled asserts the manager has
          // sent the payslip by their own means. The system has no payslip to
          // produce, so this is a claim about the world, not a state change
          // the software can verify.
          message={t('hr.noPayslipRequestsDescription')}
          busy={busy}
          onCancel={() => setFulfilling(null)}
          onConfirm={() => {
            const id = fulfilling;
            setFulfilling(null);
            if (!id) return;
            setBusy(true);
            void api.hr
              .fulfilPayslip(id)
              .then(() => mutate())
              .then(() => toast.show(t('fields.updated'), 'success'))
              .catch((e) => toast.show(translateApiError(e, t), 'danger'))
              .finally(() => setBusy(false));
          }}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
