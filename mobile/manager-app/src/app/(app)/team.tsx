import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import useSWR from 'swr';

import {
  Badge,
  BottomSheet,
  BottomTabInset,
  Button,
  DataRow,
  EmptyState,
  FilterBar,
  Input,
  MaxContentWidth,
  ScreenHeader,
  SelectSheet,
  SkeletonList,
  Spacing,
  ThemedView,
  api,
} from '@hotel-crm/mobile-shared';

import { useDebounced } from '@/lib/use-debounced';

const ROLES = ['worker', 'checker', 'manager', 'regional_manager', 'admin'] as const;

/**
 * The team.
 *
 * The list is scoped by the SERVER: a manager does not see their peers or
 * their own RM (`users/service.ts listUsers`). The search below filters what
 * the server already returned -- it is a view convenience and never the gate,
 * which is the rule `frontend/CLAUDE.md` states for the web and which holds
 * identically here.
 */
export default function Team() {
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 300).toLowerCase();

  const { data, error, isLoading, mutate } = useSWR(['users', role], () =>
    api.users.list({ role: role ?? undefined, limit: 100 })
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await mutate();
    } finally {
      setRefreshing(false);
    }
  }, [mutate]);

  const rows = (data ?? []).filter((u) =>
    q ? `${u.first_name} ${u.last_name} ${u.email}`.toLowerCase().includes(q) : true
  );

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
          }
        >
          <ScreenHeader title={t('nav.users')} />
          <FilterBar
            activeCount={(role ? 1 : 0) + (q ? 1 : 0)}
            onPress={() => setFiltersOpen(true)}
          />

          {isLoading ? (
            <SkeletonList rows={8} />
          ) : error ? (
            <EmptyState title={t('common.loadFailed')} />
          ) : rows.length === 0 ? (
            <EmptyState title={t('users.noneFound')} />
          ) : (
            rows.map((u) => (
              <DataRow
                key={u.id}
                title={`${u.first_name} ${u.last_name}`.trim() || u.email}
                subtitle={u.email}
                trailing={<Badge label={u.role} tone="neutral" />}
                onPress={() => router.push(`/team/${u.id}`)}
              />
            ))
          )}
        </ScrollView>

        <BottomSheet
          visible={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          title={t('common.filter')}
          footer={<Button label={t('common.done')} onPress={() => setFiltersOpen(false)} />}
        >
          <Input label={t('common.search')} value={search} onChangeText={setSearch} />
          <SelectSheet
            label={t('fields.role')}
            value={role}
            options={[
              { value: '__any__', label: t('common.all') },
              ...ROLES.map((r) => ({ value: r, label: r })),
            ]}
            onChange={(next) => setRole(next === '__any__' ? null : next)}
          />
        </BottomSheet>
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
