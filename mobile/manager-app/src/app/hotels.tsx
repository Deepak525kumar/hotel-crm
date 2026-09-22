import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import useSWR from 'swr';

import {
  Badge,
  DataRow,
  EmptyState,
  MaxContentWidth,
  ScreenHeader,
  SectionHeader,
  SkeletonList,
  Spacing,
  ThemedView,
  api,
  scopeOf,
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
  const user = useAuthStore((s) => s.user);
  const scope = scopeOf(user);

  const hotels = useSWR('crm/hotels', () => api.crm.hotels());
  // A manager holds hotel_groups:read for their OWN group only, so this is
  // fetched for everyone and simply comes back narrow for a hotel manager.
  const groups = useSWR('crm/hotel-groups', () => api.crm.hotelGroups());

  const canSeeOrgChart = scope.kind === 'group' || scope.kind === 'global';

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <BackLink />
          <ScreenHeader title={t('nav.hotels')} />

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
              />
            ))
          )}

          <SectionHeader title={t('nav.hotelGroups')} />
          {(groups.data ?? []).map((group) => (
            <DataRow
              key={group.id}
              title={group.name}
              // A vacancy is not a missing group: regional_manager_user_id is
              // nullable by design (2026-08-06 vacancy model), so an empty
              // value reads as "no RM assigned", never as broken data.
              subtitle={
                // 'Unassigned', not 'no hotels assigned' -- the vacancy is of
                // the REGIONAL MANAGER, and the nearest-looking key would have
                // told the manager something false about the group's hotels.
                group.regional_manager_user_id ? undefined : t('status.unassigned')
              }
              onPress={
                canSeeOrgChart ? () => router.push(`/org-chart/${group.id}`) : undefined
              }
            />
          ))}
          {groups.data && groups.data.length === 0 ? (
            <EmptyState title={t('hotelGroups.noneYet')} />
          ) : null}
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
