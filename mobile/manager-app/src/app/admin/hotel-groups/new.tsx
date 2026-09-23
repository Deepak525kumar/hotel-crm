import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router, useLocalSearchParams } from 'expo-router';
import useSWR from 'swr';

import {
  Button,
  Card,
  EmptyState,
  Input,
  MaxContentWidth,
  ScreenHeader,
  Spacing,
  ThemedView,
  api,
  translateApiError,
  useAuthStore,
  useToast,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';

/**
 * Create or edit a hotel group — S-36, admin only.
 *
 * Both routes here are `requireRole('admin')` outright, unlike the hotel
 * endpoints' flagged gate, so this screen's client check and the server's
 * agree exactly.
 *
 * `billing_info` is a STRING, not an object. It looks like it should be
 * structured and is not — the E2E setup records this as a shape that has
 * bitten before, and sending an object produces a validation error that names
 * the field without explaining it.
 *
 * NO regional-manager field. `HotelGroup.regional_manager_user_id` is written
 * exclusively by `users/service.ts#updateUserRole`, for the same reason
 * `Hotel.manager_user_id` is: a second writer here would reintroduce the
 * stale-pointer bug the person-centric redesign fixed (2026-08-07), where a
 * demotion left the group still pointing at its former RM.
 */
export default function HotelGroupForm() {
  const { t } = useTranslation();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = typeof id === 'string' && id.length > 0;

  const role = useAuthStore((s) => s.user?.role);

  const [name, setName] = useState('');
  const [billing, setBilling] = useState('');
  const [busy, setBusy] = useState(false);

  const existing = useSWR(
    editing ? ['crm/hotel-group', id] : null,
    () => api.crm.hotelGroup(String(id)),
    {
      onSuccess: (g) => {
        setName((v) => v || g.name);
        setBilling((v) => v || g.billing_info || '');
      },
    }
  );

  const ready = name.trim().length > 0;

  const save = useCallback(async () => {
    if (busy || !ready) return;
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        // Omitted rather than sent empty: the field is optional, and "" is a
        // value that would overwrite existing billing details with nothing.
        ...(billing.trim() ? { billing_info: billing.trim() } : {}),
      };
      if (editing) await api.crm.updateHotelGroup(String(id), payload);
      else await api.crm.createHotelGroup(payload);
      toast.show(t('fields.updated'), 'success');
      router.back();
    } catch (e) {
      toast.show(translateApiError(e, t), 'danger');
    } finally {
      setBusy(false);
    }
  }, [busy, ready, editing, id, name, billing, toast, t]);

  if (role !== 'admin') {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.safe}>
          <ScrollView contentContainerStyle={styles.content}>
            <BackLink />
            <EmptyState title={editing ? t('hotelGroups.adminOnlyEdit') : t('hotelGroups.adminOnlyCreate')} />
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <BackLink />
          <ScreenHeader title={editing ? t('hotelGroups.editTitle') : t('hotelGroups.newTitle')} />

          {editing && existing.error ? <EmptyState title={t('common.loadFailed')} /> : null}

          <Card>
            <Input
              label={t('fields.name')}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              error={name.trim().length === 0 ? t('common.required') : undefined}
            />
            <Input
              label={t('fields.billingInfo')}
              value={billing}
              onChangeText={setBilling}
              multiline
              autoCapitalize="sentences"
            />
          </Card>

          <Button
            label={t('common.save')}
            disabled={!ready}
            loading={busy}
            onPress={() => void save()}
          />
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
