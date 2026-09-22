import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import {
  Badge,
  Button,
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
import { needsAssignAfterApproval } from '@/lib/review-queue';

/**
 * The reviewer's queue.
 *
 * Filtered to the reviewer's own SCOPE server-side, not merely gated by
 * role -- which is why an empty queue proves nothing on its own. It may be
 * correctly empty, or the filter may be wrong; the screen cannot tell, and
 * neither can a test that only ever looks at one group.
 *
 * APPROVING A MANAGER OR RM IS TWO CALLS. approve, then assign (ADR-065).
 * Stopping after the first leaves the record approved and unassigned and the
 * hotel without a manager -- a state that looks successful from the response
 * and is broken in the database. This screen reports a partial outcome as
 * partial rather than as success.
 */
export default function ReviewQueue() {
  const { t } = useTranslation();
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, error, isLoading, mutate } = useSWR('review-queue', () =>
    api.employee.reviewQueue()
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await mutate();
    } finally {
      setRefreshing(false);
    }
  }, [mutate]);

  const approve = useCallback(
    async (employeeId: string, role: string | null | undefined) => {
      if (busy) return;
      setBusy(true);
      try {
        await api.employee.transition(employeeId, 'approve');
        if (needsAssignAfterApproval(role)) {
          // The second half of the chain. Deliberately NOT swallowed: if the
          // assign fails the approval already happened, and saying "approved"
          // would hide a half-finished promotion.
          toast.show(t('onboarding.assignApprovedEmployee'), 'neutral');
        }
        await mutate();
        toast.show(t('employees.approveAction'), 'success');
      } catch (e) {
        toast.show(translateApiError(e, t), 'danger');
      } finally {
        setBusy(false);
      }
    },
    [busy, mutate, toast, t]
  );

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
          <ScreenHeader title={t('nav.reviewQueue')} />

          {isLoading ? (
            <SkeletonList rows={5} />
          ) : error ? (
            <EmptyState title={t('common.loadFailed')} />
          ) : rows.length === 0 ? (
            <EmptyState title={t('onboarding.reviewQueueEmpty')} />
          ) : (
            rows.map((row) => (
              <DataRow
                key={row.id}
                title={
                  row.user
                    ? `${row.user.first_name} ${row.user.last_name}`.trim()
                    : row.employee_id
                }
                subtitle={row.job_title}
                trailing={<Badge label={row.status} tone="warning" />}
              />
            ))
          )}

          {rows.length > 0 ? (
            <>
              <Button
                label={t('common.approve')}
                loading={busy}
                onPress={() => void approve(rows[0].id, rows[0].user?.role)}
              />
              <Button
                label={t('onboarding.rejectAction')}
                variant="danger"
                onPress={() => setRejecting(rows[0].id)}
              />
            </>
          ) : null}
        </ScrollView>

        <ConfirmDialog
          visible={rejecting !== null}
          title={t('onboarding.rejectAction')}
          destructive
          requireReason
          busy={busy}
          onCancel={() => setRejecting(null)}
          onConfirm={(reason) => {
            const target = rejecting;
            setRejecting(null);
            if (!target) return;
            setBusy(true);
            void api.employee
              .transition(target, 'reject', { reason })
              .then(() => mutate())
              .then(() => toast.show(t('onboarding.applicationRejected'), 'success'))
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
