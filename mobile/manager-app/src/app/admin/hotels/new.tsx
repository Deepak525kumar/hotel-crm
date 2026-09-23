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
  SelectSheet,
  Spacing,
  ThemedView,
  api,
  translateApiError,
  useAuthStore,
  useToast,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';

/**
 * Create or edit a hotel — S-36, admin only.
 *
 * One screen for both: pass `?id=` to edit. A separate edit screen would be
 * the same six fields twice, and the two would drift the moment a field is
 * added — which is exactly how the web ended up with a create form that knows
 * about `timezone` and an edit form that does not.
 *
 * ADMIN ONLY, gated here on the role alone. The route itself is
 * `requireRoleFlagged(['admin','manager'], 'admin')`, so with
 * `FEATURE_GD02_MATRIX` off a *manager* would also pass the server gate while
 * an RM would not (`SIR-CRM-020`, open and deliberately unfixed). The app does
 * not mirror that quirk: a screen that appears for managers on some
 * deployments and not others is worse than one that never does, and the
 * server remains the real boundary either way.
 *
 * `hotel_group_id` IS NOT SENT ON CREATE. `createHotel` ignores it — the group
 * is assigned by a separate PATCH, which is what the edit path below does.
 * Sending it on create is silently dropped, and that is how a hotel ends up
 * ungrouped with nothing to show for it.
 */
export default function HotelForm() {
  const { t } = useTranslation();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = typeof id === 'string' && id.length > 0;

  const role = useAuthStore((s) => s.user?.role);
  const groups = useSWR('crm/hotel-groups', () => api.crm.hotelGroups());
  const existing = useSWR(editing ? ['crm/hotel', id] : null, () => api.crm.hotel(String(id)), {
    onSuccess: (h) => {
      // Seeded once, from the server's copy. Not a `useState` initialiser:
      // this screen mounts before the fetch resolves.
      setName((v) => v || h.name);
      setCity((v) => v || h.city);
      setAddress((v) => v || (h.address ?? ''));
      setCountry((v) => v || (h.country ?? 'Germany'));
      setGroupId((v) => v ?? h.hotel_group_id ?? null);
    },
  });

  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [country, setCountry] = useState('Germany');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = name.trim().length > 0 && city.trim().length > 0 && address.trim().length > 0;

  const save = useCallback(async () => {
    if (busy || !ready) return;
    setBusy(true);
    try {
      if (editing) {
        await api.crm.updateHotel(String(id), {
          name: name.trim(),
          city: city.trim(),
          address: address.trim(),
          country: country.trim(),
          hotel_group_id: groupId,
        });
      } else {
        const created = await api.crm.createHotel({
          name: name.trim(),
          city: city.trim(),
          address: address.trim(),
          country: country.trim(),
        });
        // The group is a SECOND call by design — see the block comment.
        if (groupId) await api.crm.updateHotel(created.id, { hotel_group_id: groupId });
      }
      toast.show(t('fields.updated'), 'success');
      router.back();
    } catch (e) {
      toast.show(translateApiError(e, t), 'danger');
    } finally {
      setBusy(false);
    }
  }, [busy, ready, editing, id, name, city, address, country, groupId, toast, t]);

  if (role !== 'admin') {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.safe}>
          <ScrollView contentContainerStyle={styles.content}>
            <BackLink />
            <EmptyState title={editing ? t('hotels.adminOnlyEdit') : t('hotels.adminOnlyCreate')} />
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
          <ScreenHeader title={editing ? t('hotels.editTitle') : t('hotels.new')} />

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
              label={t('fields.address')}
              value={address}
              onChangeText={setAddress}
              autoCapitalize="words"
              error={address.trim().length === 0 ? t('common.required') : undefined}
            />
            <Input
              label={t('fields.city')}
              value={city}
              onChangeText={setCity}
              autoCapitalize="words"
              error={city.trim().length === 0 ? t('common.required') : undefined}
            />
            <Input
              label={t('fields.country')}
              value={country}
              onChangeText={setCountry}
              autoCapitalize="words"
            />
            <SelectSheet
              label={t('fields.hotelGroup')}
              value={groupId}
              options={(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
              onChange={setGroupId}
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
