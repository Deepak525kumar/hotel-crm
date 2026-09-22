import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams } from 'expo-router';
import useSWR from 'swr';

import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  MaxContentWidth,
  ScreenHeader,
  SectionHeader,
  SkeletonList,
  Spacing,
  ThemedText,
  ThemedView,
  api,
  translateApiError,
  useToast,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';

export default function RequestDetail() {
  const { t } = useTranslation();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data, error, isLoading, mutate } = useSWR(id ? ['work-request', id] : null, () =>
    api.workRequests.get(String(id))
  );

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      if (busy) return;
      setBusy(true);
      try {
        await fn();
        await mutate();
        toast.show(t('fields.updated'), 'success');
      } catch (e) {
        toast.show(translateApiError(e, t), 'danger');
      } finally {
        setBusy(false);
      }
    },
    [busy, mutate, toast, t]
  );

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <BackLink />
          <ScreenHeader title={t('requests.title')} />

          {isLoading ? (
            <SkeletonList rows={4} />
          ) : error || !data ? (
            <EmptyState title={t('requests.loadFailed')} />
          ) : (
            <>
              <Card>
                <ThemedText type="h2">{data.position}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {data.hotel?.name ?? data.hotel_id}
                </ThemedText>
                <View style={styles.badges}>
                  <Badge label={data.status} tone={data.status === 'OPEN' ? 'primary' : 'neutral'} />
                  <Badge
                    label={`${data.workers_confirmed}/${data.workers_needed}`}
                    tone="neutral"
                  />
                </View>
                {data.description ? (
                  <ThemedText type="small">{data.description}</ThemedText>
                ) : null}
              </Card>

              <SectionHeader title={t('common.actions')} />
              {data.status === 'DRAFT' ? (
                <Button
                  label={t('requests.published')}
                  loading={busy}
                  onPress={() => void run(() => api.workRequests.update(String(id), { status: 'OPEN' }))}
                />
              ) : null}
              <Button
                label={t('requests.cancelRequestAction')}
                variant="danger"
                onPress={() => setCancelOpen(true)}
              />
            </>
          )}
        </ScrollView>

        <ConfirmDialog
          visible={cancelOpen}
          title={t('requests.cancelTitle')}
          destructive
          requireReason
          reasonLabel={t('requests.cancellationReason')}
          confirmLabel={t('requests.cancelRequestAction')}
          cancelLabel={t('requests.keepRequest')}
          busy={busy}
          onCancel={() => setCancelOpen(false)}
          onConfirm={(reason) => {
            setCancelOpen(false);
            void run(() =>
              api.workRequests.update(String(id), {
                status: 'CANCELLED',
                cancellation_reason: reason,
              })
            );
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
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  badges: { flexDirection: 'row', gap: Spacing.two, marginVertical: Spacing.two },
});
