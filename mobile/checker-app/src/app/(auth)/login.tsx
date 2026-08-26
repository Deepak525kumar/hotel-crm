import { useState } from 'react';
import { Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuthStore, RoleNotAllowedError } from '@/stores/auth-store';
import { Spacing } from '@/constants/theme';
import { APP_NAME } from '@/constants/app-config';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError } from '@/lib/api';
import { useTranslation } from 'react-i18next';
import { translateApiError } from '../../lib/api-error-i18n';

export default function LoginScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { login, isLoading } = useAuthStore();
  const router = useRouter();
  const params = useLocalSearchParams();
  const theme = useTheme();

  const handleLogin = async () => {
    setError(null);
    if (!email.trim() || !password.trim()) {
      setError(t("auth.credentialsRequired"));
      return;
    }
    try {
      await login(email.trim(), password);
      if (params.returnTo) {
        router.replace(params.returnTo as any);
      } else {
        router.replace('/(app)');
      }
    } catch (err) {
      if (err instanceof RoleNotAllowedError) {
        setError(t('auth.noAppAccess'));
      } else if (err instanceof ApiError && err.status === 429) {
        setError(
          err.retryAfterSeconds !== undefined
            ? t('auth.tooManyAttemptsRetry', { seconds: err.retryAfterSeconds })
            : t('auth.tooManyAttempts'),
        );
      } else if (err instanceof ApiError) {
        setError(translateApiError(err, t));
      } else {
        setError(t("auth.loginFailed"));
      }
    }
  };

  // Sends the reset email from the app rather than handing off to the web.
  // This opened EXPO_PUBLIC_FRONTEND_URL, which nothing sets in practice, so it
  // fell back to http://localhost:3000 -- on a phone, localhost is the phone,
  // and the button opened a dead page.
  const handleForgotPassword = async () => {
    setError(null);
    if (!email.trim()) {
      setError(t('auth.enterEmailForReset'));
      return;
    }
    try {
      await api.auth.requestPasswordReset(email);
      Alert.alert(t('settings.resetPasswordSent'));
    } catch (err) {
      setError(translateApiError(err, t, 'settings.resetPasswordFailed'));
    }
  };

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ThemedText type="title" style={styles.title}>
          Hotel CRM
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
          {APP_NAME}
        </ThemedText>

        <ThemedView style={styles.form}>
          <TextInput
            style={[
              styles.input,
              {
                color: theme.text,
                borderColor: theme.backgroundSelected,
                backgroundColor: theme.backgroundElement,
              },
            ]}
            placeholder={t("auth.email")}
            placeholderTextColor={theme.textSecondary}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            // Autocorrect can rewrite an address outright (a domain
            // "corrected" to a dictionary word), which fails the same
            // silent way.
            autoCorrect={false}
            spellCheck={false}
            keyboardType="email-address"
            autoComplete="email"
            editable={!isLoading}
          />
          <TextInput
            style={[
              styles.input,
              {
                color: theme.text,
                borderColor: theme.backgroundSelected,
                backgroundColor: theme.backgroundElement,
              },
            ]}
            placeholder={t("auth.passwordPlaceholder")}
            placeholderTextColor={theme.textSecondary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            // React Native defaults autoCapitalize to "sentences". On iOS a
            // secure field still applies it, so the first character of a typed
            // password is silently upper-cased and login fails with "Invalid
            // credentials" on a correct password -- while the same credentials
            // work on web, which has no such behaviour. The email field above
            // already set this; the password field did not.
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="current-password"
            editable={!isLoading}
          />

          {error && (
            <ThemedText type="small" style={styles.errorText}>
              {error}
            </ThemedText>
          )}

          <Pressable
            onPress={handleLogin}
            disabled={isLoading}
            style={({ pressed }) => [{ opacity: pressed || isLoading ? 0.7 : 1 }]}
          >
            <ThemedView type="backgroundElement" style={styles.button}>
              {isLoading ? (
                <ActivityIndicator color={theme.text} />
              ) : (
                <ThemedText type="smallBold">{t("auth.signIn")}</ThemedText>
              )}
            </ThemedView>
          </Pressable>

          <Pressable onPress={handleForgotPassword} style={styles.forgotPasswordContainer}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.forgotPasswordText}>{t("auth.forgotPassword")}</ThemedText>
          </Pressable>
        </ThemedView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  title: {
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
  },
  form: {
    width: '100%',
    maxWidth: 400,
    gap: Spacing.three,
    marginTop: Spacing.four,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  errorText: {
    color: '#E53E3E',
    textAlign: 'center',
  },
  button: {
    height: 48,
    borderRadius: Spacing.two,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  forgotPasswordContainer: {
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  forgotPasswordText: {
    textDecorationLine: 'underline',
  },
});
