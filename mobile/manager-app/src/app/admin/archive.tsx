import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Redirect } from 'expo-router';
import useSWR from 'swr';

import {
  Button,
  ConfirmDialog,
  DataRow,
  EmptyState,
  MaxContentWidth,
  ScreenHeader,
  SectionHeader,
  SkeletonList,
  Spacing,
  ThemedView,
  api,
  translateApiError,
  useAuthStore,
  useToast,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';

/**
 * Archived hotels and groups, and restoring them.
 *
 * ADMIN ONLY, and gated here as well as server-side: every route behind this
 * screen is `requireRole('admin')`. A manager or RM who reaches the path
 * directly is redirected rather than shown an empty list, because an empty
 * archive and a forbidden archive look identical and the first reads as
 * "nothing is archived".
 *
 * RESTORE IS THE INVERSE OF DELETE, NOT OF DEACTIVATE. Those are the
 * temporary pair; confusing them would "restore" something merely paused
 * while leaving a deleted entity gone. The backend comment says so at the
 * route; this repeats it because the two words are easy to swap.
 *
 * Restoring a hotel does NOT restore its scope bindings. Scenario 20 exists
 * because deleting an entity used to leave ghost assignments and dangling
 * scope pointers -- so after restoring, the manager appointment must be
 * checked rather than assumed.
 */
export default function Archive() {
  const { t } = useTranslation();
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const [confirming, setConfirming] = useState<
    { kind: 'hotel' | 'group'; id: string; name: string } | null
  >(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = user?.role === 'admin';

  const hotels = useSWR(isAdmin ? 'archived-hotels' : null, () => api.crm.archivedHotels());
  const groups = useSWR(isAdmin ? 'archived-groups' : null, () =>
    api.crm.archivedHotelGroups()
  );

  const restore = useCallback(async () => {
    if (!confirming || busy) return;
    setBusy(true);
    try {
      if (confirming.kind === 'hotel') {
        await api.crm.restoreHotel(confirming.id);
        await hotels.mutate();
      } else {
        await api.crm.restoreHotelGroup(confirming.id);
        await groups.mutate();
      }
      toast.show(t('fields.updated'), 'success');
    } catch (e) {
      toast.show(translateApiError(e, t), 'danger');
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }, [confirming, busy, hotels, groups, toast, t]);

  // Redirect, not an empty list: a manager must not be left concluding the
  // archive is empty when it is simply not theirs to see.
  if (user && !isAdmin) return <Redirect href="/(app)" />;

  const archivedHotels = hotels.data ?? [];
  const archivedGroups = groups.data ?? [];

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <BackLink />
          <ScreenHeader title={t('nav.archive')} />

          <SectionHeader title={t('nav.hotels')} />
          {hotels.isLoading ? (
            <SkeletonList rows={3} />
          ) : hotels.error ? (
            <EmptyState title={t('common.loadFailed')} />
          ) : archivedHotels.length === 0 ? (
            <EmptyState title={t('hotels.noneFound')} />
          ) : (
            archivedHotels.map((hotel) => (
              <DataRow
                key={hotel.id}
                title={hotel.name}
                subtitle={hotel.city}
                trailing={
                  <Button
                    label={t('common.restore')}
                    variant="ghost"
                    onPress={() =>
                      setConfirming({ kind: 'hotel', id: hotel.id, name: hotel.name })
                    }
                  />
                }
              />
            ))
          )}

          <SectionHeader title={t('nav.hotelGroups')} />
          {archivedGroups.length === 0 ? (
            <EmptyState title={t('hotelGroups.noneYet')} />
          ) : (
            archivedGroups.map((group) => (
              <DataRow
                key={group.id}
                title={group.name}
                trailing={
                  <Button
                    label={t('common.restore')}
                    variant="ghost"
                    onPress={() =>
                      setConfirming({ kind: 'group', id: group.id, name: group.name })
                    }
                  />
                }
              />
            ))
          )}
        </ScrollView>

        <ConfirmDialog
          visible={confirming !== null}
          title={t('common.restore')}
          message={confirming?.name}
          confirmLabel={t('common.restore')}
          busy={busy}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void restore()}
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
