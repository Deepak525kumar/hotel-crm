import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { NotificationBell } from '@/components/NotificationBell';
import { Badge, Button, Card, ListRow, SectionHeader } from '@/components/ui';
import { useAuthStore } from '@/stores/auth-store';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Profile.
 *
 * Rebuilt on the shared UI primitives, matching worker-app's profile screen
 * position for position: identity block, reporting line, quick links, sign out.
 * The previous version hand-rolled cards out of ThemedView plus divider views
 * and painted them with hex literals, which is the pattern constants/theme.ts
 * exists to stop -- a card painted `#FFFFFF` inline reads white-on-white in
 * dark mode.
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

  const fullName = `${user.first_name} ${user.last_name}`.trim();
  const initials = `${user.first_name?.[0] ?? ''}${user.last_name?.[0] ?? ''}`.toUpperCase();

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
                accessibilityLabel={t('settings.title')}
                onPress={() => router.push('/settings')}
                hitSlop={12}
                style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
              >
                <SymbolView
                  name={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
                  tintColor={theme.text}
                  size={24}
                />
              </Pressable>
            </View>
          </View>

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
              </View>
            </View>
          </Card>

          {user.manager_name || user.creator_name ? (
            <>
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
            {/* Alerts are reached from the bell in every screen header, so no
                row here -- it would be a second, staler way in. */}
            <ListRow
              title={t('consent.view')}
              onPress={() => router.push('/consent')}
              right={<ThemedText themeColor="textSecondary">›</ThemedText>}
              last
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
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
