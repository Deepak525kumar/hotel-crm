import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { NotificationBell } from '@/components/NotificationBell';
import { Badge, Button, Card, ListRow, SectionHeader } from '@/components/ui';
import { useAuthStore } from '@/stores/auth-store';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { workerDisplayName } from '@/lib/greeting';

/**
 * Profile.
 *
 * Was a details card followed by five identical full-width grey slabs, so
 * "View documents", "Sign out" and everything between them had exactly the
 * same visual weight and nothing could be found at a glance. Now: an identity
 * header, then grouped navigation rows, then the destructive action on its
 * own, styled as destructive.
 *
 * It also carries the entry points the three-tab bar no longer has room for
 * (notifications, jobs), which is why the list is longer than it looks.
 */
export default function ProfileScreen() {
  const { t } = useTranslation();
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const theme = useTheme();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      router.replace('/(auth)/login');
    } finally {
      setIsLoggingOut(false);
    }
  };

  if (!user) return null;

  const displayName = workerDisplayName(user.first_name);
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  // Initials for the avatar, falling back to the email so the circle is never
  // empty (and never shows a cuid fragment).
  const initials =
    (displayName?.[0] ?? user.email?.[0] ?? '?').toUpperCase() +
    (user.last_name?.[0]?.toUpperCase() ?? '');

  const employmentTone =
    user.employment_status === 'ACTIVE'
      ? 'success'
      : user.employment_status === 'PENDING'
        ? 'warning'
        : 'neutral';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.headerRow}>
            <ThemedText type="title">{t('profile.title')}</ThemedText>
            <View style={styles.headerActions}>
              <NotificationBell />
              <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('nav.settings')}
              onPress={() => router.push('/settings')}
              hitSlop={12}
              style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
            >
                <ThemedText type="subtitle">⚙</ThemedText>
              </Pressable>
            </View>
          </View>

          {/* The identity block is the natural place to tap for "my details",
              and it was inert until now. */}
          <Pressable
            onPress={() => router.push('/profile-details')}
            accessibilityRole="button"
            accessibilityLabel={t('profile.myDetails')}
            style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
          >
            <Card style={styles.identity}>
            <View style={[styles.avatar, { backgroundColor: theme.primarySubtle }]}>
              <ThemedText type="subtitle" style={{ color: theme.primary }}>
                {initials}
              </ThemedText>
            </View>
            <View style={styles.identityText}>
              <ThemedText type="smallBold" numberOfLines={1}>
                {fullName || user.email}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {user.email}
              </ThemedText>
              <View style={styles.badges}>
                <Badge label={user.role} tone="primary" />
                {user.employment_status ? (
                  <Badge label={user.employment_status} tone={employmentTone} />
                ) : null}
              </View>
            </View>
            </Card>
          </Pressable>

          {user.manager_name || user.creator_name ? (
            <>
              {/* Titled "Overview", but it only ever showed who a worker
                  reports to -- no summary of anything. Named for its contents
                  instead, and the last row drops the divider that sat against
                  the card edge. */}
              <SectionHeader title={t('profile.reportingLine')} />
              <Card>
                {user.manager_name ? (
                  <ListRow
                    title={t('profile.directManager')}
                    subtitle={user.manager_name}
                    last={!user.creator_name}
                  />
                ) : null}
                {user.creator_name ? (
                  <ListRow title={t('requests.createdBy')} subtitle={user.creator_name} last />
                ) : null}
              </Card>
            </>
          ) : null}

          <SectionHeader title={t('common.quickLinks')} />
          <Card style={styles.linkCard}>
            <ListRow
              title={t('documents.viewAll')}
              onPress={() => router.push('/documents')}
              right={<ThemedText themeColor="textSecondary">›</ThemedText>}
            />
            <ListRow
              title={t('hr.view')}
              onPress={() => router.push('/hr')}
              right={<ThemedText themeColor="textSecondary">›</ThemedText>}
            />
            <ListRow
              title={t('leaderboard.view')}
              onPress={() => router.push('/ratings')}
              right={<ThemedText themeColor="textSecondary">›</ThemedText>}
            />
            {/* Alerts are reached from the bell in every screen header now,
                so this row would be a second, staler way in. Jobs still needs
                one -- it lost its tab when the bar went to three. */}
            <ListRow
              title={t('nav.jobs')}
              onPress={() => router.push('/(app)/marketplace')}
              right={<ThemedText themeColor="textSecondary">›</ThemedText>}
            />
            <ListRow
              title={t('consent.view')}
              onPress={() => router.push('/consent')}
              right={<ThemedText themeColor="textSecondary">›</ThemedText>}
            />
          </Card>

          <Button
            label={t('profile.signOut')}
            variant="ghost"
            onPress={() => void handleLogout()}
            loading={isLoggingOut}
            style={styles.signOut}
          />
          {isLoggingOut ? <ActivityIndicator color={theme.text} /> : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.two,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityText: { flex: 1, gap: Spacing.half },
  badges: { flexDirection: 'row', gap: Spacing.one, marginTop: Spacing.half },
  // The rows draw their own dividers, so the card supplies no extra gap.
  linkCard: { gap: 0, paddingVertical: 0 },
  signOut: { marginTop: Spacing.three },
});
