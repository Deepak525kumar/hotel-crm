import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import useSWR from 'swr';

import {
  Badge,
  Button,
  DataRow,
  EmptyState,
  MaxContentWidth,
  ScreenHeader,
  SkeletonList,
  Spacing,
  ThemedView,
  api,
  useAuthStore,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';

/**
 * Hotels and groups, read-only for a manager or RM.
 *
 * Create, edit, archive and restore are MASTER DATA and Admin-only
 * (ADR-030 D-2/D-3), so none of those controls exist here. The org chart is
 * linked only for an RM or admin -- `org_chart:read` is the single token an
 * RM holds that a Manager does not (D-5), which makes it the one place the
 * two roles legitimately diverge in this app.
 */
export default function Hotels() {
  const { t } = useTranslation();
  const role = useAuthStore((st) => st.user?.role);

  const hotels = useSWR('crm/hotels', () => api.crm.hotels());

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <BackLink />
          <ScreenHeader
            title={t('nav.hotels')}
            // Admin only: creating a hotel is master data. The route is
            // `requireRoleFlagged(['admin','manager'], 'admin')`, so with the
            // matrix flag off a manager would also pass the SERVER gate
            // (SIR-CRM-020) -- the app deliberately does not mirror that, so
            // the control does not appear and disappear with a flag.
            action={
              role === 'admin' ? (
                <Button
                  label={t('hotels.new')}
                  variant="ghost"
                  onPress={() => router.push('/admin/hotels/new')}
                />
              ) : undefined
            }
          />

          {hotels.isLoading ? (
            <SkeletonList rows={5} />
          ) : hotels.error ? (
            <EmptyState title={t('common.loadFailed')} />
          ) : (hotels.data ?? []).length === 0 ? (
            <EmptyState title={t('hotels.noneFound')} />
          ) : (
            (hotels.data ?? []).map((hotel) => (
              <DataRow
                key={hotel.id}
                title={hotel.name}
                subtitle={hotel.city}
                trailing={
                  <Badge
                    label={hotel.is_active ? t('status.active') : t('status.inactive')}
                    tone={hotel.is_active ? 'success' : 'neutral'}
                  />
                }
                // Opens the hotel: today's numbers, rooms logged, and the
                // blocklist. The list rows were not tappable before, so the
                // detail screen existed and nothing reached it.
                onPress={() => router.push(`/hotel/${hotel.id}`)}
              />
            ))
          )}

        </ScrollView>
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
