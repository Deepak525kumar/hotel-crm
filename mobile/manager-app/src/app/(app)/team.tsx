import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import useSWR from 'swr';

import {
  BottomSheet,
  BottomTabInset,
  Button,
  EmptyState,
  FilterBar,
  Input,
  MaxContentWidth,
  ScreenHeader,
  SectionHeader,
  SelectSheet,
  SkeletonList,
  Spacing,
  ThemedText,
  ThemedView,
  api,
  useAuthStore,
} from '@hotel-crm/mobile-shared';

import { NotificationBell } from '@/components/NotificationBell';
import { PersonRow } from '@/components/PersonRow';
import { creatableRoles, roleLabelKey } from '@/lib/creatable-roles';
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
  const user = useAuthStore((s) => s.user);
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

  /**
   * Grouped by role, in seniority order.
   *
   * The flat list repeated a role badge on every row and had no structure —
   * eight people read as eight identical cards. A section header states the
   * role once and frees the row for the name and the email, which is what
   * actually distinguishes one person from another.
   *
   * Roles with nobody in them are dropped rather than rendering an empty
   * header.
   */
  const sections = useMemo(() => {
    const order = ['admin', 'regional_manager', 'manager', 'checker', 'worker'] as const;
    return order
      .map((r) => ({ role: r, people: rows.filter((u) => u.role === r) }))
      .filter((section) => section.people.length > 0);
  }, [rows]);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
          }
        >
          <ScreenHeader title={t('nav.users')} action={<NotificationBell />} />
          <View style={styles.bar}>
            <FilterBar
              activeCount={(role ? 1 : 0) + (q ? 1 : 0)}
              onPress={() => setFiltersOpen(true)}
            />
            {/* Hidden for an actor who may create nobody (RULE A), rather
                than shown and refused. */}
            {creatableRoles(user?.role).length > 0 ? (
              <Button
                label={t('users.newTitle')}
                variant="ghost"
                onPress={() => router.push('/team/new')}
              />
            ) : null}
          </View>

          {isLoading ? (
            <SkeletonList rows={8} />
          ) : error ? (
            <EmptyState title={t('common.loadFailed')} />
          ) : rows.length === 0 ? (
            <EmptyState title={t('users.noneFound')} />
          ) : (
            sections.map((section) => (
              <View key={section.role} style={styles.section}>
                <SectionHeader
                  title={t(roleLabelKey(section.role))}
                  action={
                    <ThemedText type="small" themeColor="textSecondary">
                      {section.people.length}
                    </ThemedText>
                  }
                />
                {section.people.map((u) => (
                  <PersonRow
                    key={u.id}
                    id={u.id}
                    name={`${u.first_name} ${u.last_name}`.trim() || u.email}
                    email={u.email}
                    status={u.employment_status}
                    hasPhoto={u.has_profile_photo}
                    onPress={() => router.push(`/team/${u.id}`)}
                  />
                ))}
              </View>
            ))
          )}
        </ScrollView>

        <BottomSheet
          visible={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          title={t('common.filter')}
          footer={
            /* A way BACK to "no filters" -- see requests.tsx's note. */
            <View style={styles.sheetActions}>
              <Button
                label={t('common.reset')}
                variant="ghost"
                disabled={role === null && search === ''}
                style={styles.sheetAction}
                onPress={() => {
                  setRole(null);
                  setSearch('');
                }}
              />
              <Button
                label={t('common.done')}
                style={styles.sheetAction}
                onPress={() => setFiltersOpen(false)}
              />
            </View>
          }
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
  sheetActions: { flexDirection: 'row', gap: Spacing.two },
  sheetAction: { flex: 1 },
  root: { flex: 1 },
  safe: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  section: { gap: Spacing.two },
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
    paddingBottom: BottomTabInset,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
