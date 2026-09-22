import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTranslation } from 'react-i18next';

import {
  Button,
  Input,
  Spacing,
  ThemedText,
  ThemedView,
  translateApiError,
  useAuthStore,
} from '@hotel-crm/mobile-shared';
import { APP_NAME } from '@/constants/app-config';

export default function Login() {
  const { t } = useTranslation();
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      // No navigation here on purpose: index.tsx owns the redirect, and it is
      // the only place that runs role admission. Pushing a route from here
      // would let a worker past the wrong-app screen.
    } catch (e) {
      // translateApiError, not a hand-written string: it honours the server's
      // own message when there is one and falls back to a translated key
      // otherwise, so a locked or throttled account explains itself in the
      // manager's language instead of reading as a generic failure.
      setError(translateApiError(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          style={styles.safe}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <ThemedText type="h1">{APP_NAME}</ThemedText>
              <ThemedText themeColor="textSecondary">
                Sign in with your work email.
              </ThemedText>
            </View>

            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              textContentType="username"
              autoComplete="email"
            />
            {/* autoCapitalize/autoCorrect/spellCheck are off by default in
                Input, which is what this field needs: iOS silently uppercases
                a password's first character, and the result is "wrong
                credentials" for a correctly typed password with nothing on
                screen to explain it. */}
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              onSubmitEditing={() => void submit()}
              returnKeyType="go"
            />

            {error ? <ThemedText themeColor="danger">{error}</ThemedText> : null}

            <Button label="Sign in" onPress={() => void submit()} loading={busy} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  body: { flexGrow: 1, justifyContent: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four },
  header: { gap: Spacing.two, marginBottom: Spacing.three },
});
