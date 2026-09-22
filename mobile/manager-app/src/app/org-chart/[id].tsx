import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams } from 'expo-router';
import useSWR from 'swr';

import {
  ApiError,
  Card,
  EmptyState,
  MaxContentWidth,
  ScreenHeader,
  SkeletonList,
  Spacing,
  ThemedText,
  ThemedView,
  api,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';

/**
 * The group's org chart.
 *
 * `org_chart:read` is the ONE capability where a Regional Manager
 * legitimately diverges from a Manager (ADR-030 §3 C-33, D-5): CRR §1 makes
 * the chart visible only to an RM and an Admin. A Manager reaching this route
 * is refused by the server, and this screen says so rather than rendering an
 * empty chart -- an empty chart looks like a group with no people in it.
 */
export default function OrgChart() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, error, isLoading } = useSWR(id ? ['org-chart', id] : null, () =>
    api.employee.orgChart(String(id))
  );

  const forbidden = error instanceof ApiError && (error.status === 403 || error.status === 401);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <BackLink />
          <ScreenHeader title={t('hotels.orgChart')} />

          {isLoading ? (
            <SkeletonList rows={5} />
          ) : forbidden ? (
            <EmptyState title={t('errors.forbidden')} />
          ) : error ? (
            <EmptyState title={t('common.loadFailed')} />
          ) : (
            <Card>
              {/* The endpoint's shape is a nested tree whose exact contract is
                  not pinned in this client yet; rendered as a readable summary
                  rather than typed optimistically into a shape nobody read
                  back -- which is the mistake DashboardStats already made. */}
              <ThemedText type="small">{JSON.stringify(data, null, 2)}</ThemedText>
            </Card>
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
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
