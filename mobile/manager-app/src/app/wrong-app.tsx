import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Spacing, ThemedText, ThemedView, useAuthStore } from '@hotel-crm/mobile-shared';
import { admit } from '@/lib/role-admission';

/**
 * Where a worker or checker lands if they sign in here.
 *
 * checker-app shipped without this and the result was instructive: a role the
 * app did not serve got the normal shell with every query returning 403, which
 * reads as "this app is broken", not "you want the other one". People then
 * report a bug that does not exist.
 *
 * Naming the right app is the entire point of the screen.
 */
export default function WrongApp() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const admission = admit(user);

  const message =
    admission.kind === 'wrong-app'
      ? admission.app === 'worker'
        ? 'This is the manager app. Your shifts, rooms and payslips are in the Hotel CRM Worker app.'
        : 'This is the manager app. Your inspections and rework are in the Hotel CRM Checker app.'
      : 'This app is for hotel managers, regional managers and admins. Your account does not have one of those roles.';

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.body}>
          <ThemedText type="h1">Wrong app</ThemedText>
          <ThemedText themeColor="textSecondary">{message}</ThemedText>
          {/* Signing out is the only action: there is nothing in this build
              this account may open, and leaving them signed in would put them
              back here on next launch. */}
          <Button label="Sign out" onPress={() => void logout()} />
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  body: { flex: 1, justifyContent: 'center', gap: Spacing.four, paddingHorizontal: Spacing.four },
});
