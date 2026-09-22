import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
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
  ThemedText,
  ThemedView,
  api,
  translateApiError,
  useAuthStore,
  useToast,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';
import { creatableRoles, scopeFieldFor } from '@/lib/creatable-roles';
import { SKILL_TAGS } from '@/lib/shift-form';

/**
 * Create an account.
 *
 * WHICH ROLES ARE OFFERED IS RULE A, and the list comes from a mirror pinned
 * against `backend/src/lib/role-hierarchy.ts`. A manager sees worker and
 * checker; a regional manager sees manager; nobody sees admin, admins
 * included. Offering more would produce a 403 the manager cannot act on.
 *
 * The request is MULTIPART because the route takes a photo, and `skills` goes
 * as a comma-separated string — multipart cannot carry an array, which is why
 * the schema preprocesses one.
 */
export default function NewTeamMember() {
  const { t } = useTranslation();
  const toast = useToast();
  const actor = useAuthStore((s) => s.user);
  const [busy, setBusy] = useState(false);

  const roles = creatableRoles(actor?.role);
  const [role, setRole] = useState<string | null>(roles[0] ?? null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [skills, setSkills] = useState<string[]>([]);

  const scopeField = role ? scopeFieldFor(role) : null;
  const hotels = useSWR(scopeField === 'hotel' ? 'crm/hotels' : null, () => api.crm.hotels());
  const groups = useSWR(scopeField === 'group' ? 'crm/hotel-groups' : null, () =>
    api.crm.hotelGroups()
  );

  const ready =
    role !== null &&
    /\S+@\S+\.\S+/.test(email.trim()) &&
    password.length >= 8 &&
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    phone.trim().length > 0 &&
    (scopeField === null || scopeId !== null);

  const submit = async () => {
    if (!ready || !role || busy) return;
    setBusy(true);
    try {
      const created = await api.users.create({
        email: email.trim().toLowerCase(),
        password,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        role,
        ...(scopeField === 'hotel' && scopeId ? { hotel_id: scopeId } : {}),
        ...(scopeField === 'group' && scopeId ? { hotel_group_id: scopeId } : {}),
        // Comma-separated, not an array: multipart cannot carry one and the
        // schema preprocesses the string.
        ...(skills.length > 0 ? { skills: skills.join(',') } : {}),
      });
      toast.show(t('fields.updated'), 'success');
      router.replace(`/team/${created.id}`);
    } catch (e) {
      toast.show(translateApiError(e, t), 'danger');
    } finally {
      setBusy(false);
    }
  };

  // A worker or checker reaching this screen can create nobody. Saying so
  // beats an empty role picker, which reads as a broken form.
  if (roles.length === 0) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.safe}>
          <ScrollView contentContainerStyle={styles.content}>
            <BackLink />
            <EmptyState title={t('errors.forbidden')} />
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <BackLink />
          <ScreenHeader title={t('users.newTitle')} />

          <Card>
            <SelectSheet
              label={t('fields.role')}
              value={role}
              options={roles.map((r) => ({ value: r, label: r }))}
              onChange={(next) => {
                setRole(next);
                // The scope question changes with the role, so a stale answer
                // would silently send the wrong hotel.
                setScopeId(null);
              }}
            />
            <Input label={t('fields.firstName')} value={firstName} onChangeText={setFirstName} autoCapitalize="words" />
            <Input label={t('fields.lastName')} value={lastName} onChangeText={setLastName} autoCapitalize="words" />
            <Input
              label={t('fields.email')}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
            />
            <Input label={t('fields.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <Input
              label={t('fields.temporaryPassword')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              error={password.length > 0 && password.length < 8 ? t('common.required') : undefined}
            />
          </Card>

          {scopeField ? (
            <Card>
              <SelectSheet
                label={scopeField === 'hotel' ? t('nav.hotels') : t('nav.hotelGroups')}
                value={scopeId}
                options={
                  scopeField === 'hotel'
                    ? (hotels.data ?? [])
                        .filter((h) => h.is_active)
                        .map((h) => ({ value: h.id, label: h.name, hint: h.city }))
                    : (groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))
                }
                onChange={setScopeId}
              />
            </Card>
          ) : null}

          {role === 'worker' ? (
            <Card>
              <ThemedText type="smallBold">{t('fields.skills')}</ThemedText>
              {SKILL_TAGS.map((skill) => (
                <Button
                  key={skill}
                  label={skill}
                  variant={skills.includes(skill) ? 'primary' : 'ghost'}
                  onPress={() =>
                    setSkills((s) =>
                      s.includes(skill) ? s.filter((x) => x !== skill) : [...s, skill]
                    )
                  }
                />
              ))}
            </Card>
          ) : null}

          <Button label={t('common.save')} disabled={!ready} loading={busy} onPress={() => void submit()} />
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
