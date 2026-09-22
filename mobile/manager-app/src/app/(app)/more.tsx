import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';

import {
  BottomTabInset,
  DataRow,
  MaxContentWidth,
  ScreenHeader,
  SectionHeader,
  Spacing,
  ThemedView,
  scopeOf,
  useAuthStore,
} from '@hotel-crm/mobile-shared';

/**
 * Everything the tab bar has no room for.
 *
 * The web sidebar has eighteen entries; five tabs plus this menu is how they
 * fit on a phone without the bar becoming unscannable. Entries are gated the
 * same way the screens behind them are -- a row that opens a 403 is worse
 * than an absent row, because it teaches the manager the app is unreliable.
 */
export default function More() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const scope = scopeOf(user);
  const isAdmin = user?.role === 'admin';

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content}>
          <ScreenHeader title={t('nav.more')} />

          <SectionHeader title={t('nav.assignments')} />
          <DataRow title={t('nav.assignments')} onPress={() => router.push('/assignments')} />
          <DataRow title={t('nav.requests')} onPress={() => router.push('/requests')} />
          <DataRow title={t('nav.reviewQueue')} onPress={() => router.push('/review-queue')} />

          <SectionHeader title={t('nav.analytics')} />
          <DataRow title={t('nav.analytics')} onPress={() => router.push('/analytics')} />
          <DataRow title={t('nav.leaderboard')} onPress={() => router.push('/leaderboard')} />

          <SectionHeader title={t('nav.hotels')} />
          <DataRow title={t('nav.hotels')} onPress={() => router.push('/hotels')} />

          <SectionHeader title={t('nav.account')} />
          <DataRow
            title={t('nav.notifications')}
            onPress={() => router.push('/notifications')}
          />
          <DataRow title={t('nav.settings')} onPress={() => router.push('/settings')} />

          {/* Admin-only master data. Absent for a manager or RM rather than
              present-and-refused: ADR-030 D-2/D-3 make these Admin-only, and
              scope.kind === 'global' is the claim that actually distinguishes
              an admin from an RM (both have a null scope_hotel_id). */}
          {isAdmin && scope.kind === 'global' ? (
            <>
              <SectionHeader title={t('nav.archive')} />
              <DataRow title={t('nav.archive')} onPress={() => router.push('/admin/archive')} />
            </>
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
    paddingBottom: BottomTabInset,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
