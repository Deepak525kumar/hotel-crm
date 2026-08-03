import { StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuthStore } from '@/stores/auth-store';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useState } from 'react';

export default function ProfileScreen() {
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

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.header}>
          Profile
        </ThemedText>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedView style={styles.row} type="backgroundElement">
            <ThemedText type="small" themeColor="textSecondary">
              Name
            </ThemedText>
            <ThemedText type="small">
              {user.first_name} {user.last_name}
            </ThemedText>
          </ThemedView>
          <ThemedView style={styles.divider} type="backgroundSelected" />
          <ThemedView style={styles.row} type="backgroundElement">
            <ThemedText type="small" themeColor="textSecondary">
              Email
            </ThemedText>
            <ThemedText type="small">{user.email}</ThemedText>
          </ThemedView>
          <ThemedView style={styles.divider} type="backgroundSelected" />
          <ThemedView style={styles.row} type="backgroundElement">
            <ThemedText type="small" themeColor="textSecondary">
              Role
            </ThemedText>
            <ThemedText type="small" style={styles.roleText}>
              {user.role}
            </ThemedText>
          </ThemedView>
        </ThemedView>

        <Pressable
          onPress={() => router.push('/ratings')}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
        >
          <ThemedView type="backgroundElement" style={styles.logoutButton}>
            <ThemedText type="smallBold">View Leaderboard</ThemedText>
          </ThemedView>
        </Pressable>

        <Pressable
          onPress={() => router.push('/documents')}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
        >
          <ThemedView type="backgroundElement" style={styles.logoutButton}>
            <ThemedText type="smallBold">View Documents</ThemedText>
          </ThemedView>
        </Pressable>

        <Pressable
          onPress={() => router.push('/consent')}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
        >
          <ThemedView type="backgroundElement" style={styles.logoutButton}>
            <ThemedText type="smallBold">View Consent</ThemedText>
          </ThemedView>
        </Pressable>

        <Pressable
          onPress={() => router.push('/hr')}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
        >
          <ThemedView type="backgroundElement" style={styles.logoutButton}>
            <ThemedText type="smallBold">View HR & Payroll</ThemedText>
          </ThemedView>
        </Pressable>

        <Pressable
          onPress={handleLogout}
          disabled={isLoggingOut}
          style={({ pressed }) => [{ opacity: pressed || isLoggingOut ? 0.7 : 1 }]}
        >
          <ThemedView type="backgroundElement" style={styles.logoutButton}>
            {isLoggingOut ? (
              <ActivityIndicator color={theme.text} />
            ) : (
              <ThemedText type="smallBold" style={styles.logoutText}>
                Sign Out
              </ThemedText>
            )}
          </ThemedView>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    gap: Spacing.three,
  },
  header: {
    paddingBottom: Spacing.two,
  },
  card: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  divider: {
    height: 1,
    marginHorizontal: Spacing.three,
  },
  roleText: {
    textTransform: 'capitalize',
  },
  logoutButton: {
    height: 48,
    borderRadius: Spacing.two,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoutText: {
    color: '#E53E3E',
  },
});
