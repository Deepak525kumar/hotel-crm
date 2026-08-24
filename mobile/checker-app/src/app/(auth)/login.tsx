import { useState } from 'react';
import {
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
import { useAuthStore } from '@/stores/auth-store';
import { Spacing } from '@/constants/theme';
import { APP_NAME, ALLOWED_ROLES } from '@/constants/app-config';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import * as WebBrowser from 'expo-web-browser';
import { useTranslation } from 'react-i18next';
import { translateApiError } from '../../lib/api-error-i18n';

export default function LoginScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { login, logout, isLoading } = useAuthStore();
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
      const user = useAuthStore.getState().user;
      if (user && !ALLOWED_ROLES.includes(user.role)) {
        await logout();
        setError(t("auth.noAppAccess"));
        return;
      }
      if (params.returnTo) {
        router.replace(params.returnTo as string);
      } else {
        router.replace('/(app)');
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
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

  const handleForgotPassword = async () => {
    const frontendUrl = process.env.EXPO_PUBLIC_FRONTEND_URL ?? 'http://localhost:3000';
    await WebBrowser.openBrowserAsync(`${frontendUrl}/forgot-password`);
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
