import { useState } from 'react';
import { StyleSheet, Pressable, ActivityIndicator, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { LOCALE_LABELS, UI_LOCALES, type UiLocale } from '@/lib/locales';
import { useLocaleStore } from '@/stores/locale-store';

/**
 * Language picker for the worker app.
 *
 * A list of tappable rows rather than a native picker: the labels are
 * endonyms across six scripts (two of them RTL), and a list lets each row
 * carry its own `writingDirection` so the Arabic and Urdu names render
 * correctly even while the surrounding app is still laid out left-to-right.
 */
export function LanguagePicker() {
  const { t } = useTranslation();
  const theme = useTheme();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const needsRestart = useLocaleStore((s) => s.needsRestartForRtl);
  const [pending, setPending] = useState<UiLocale | null>(null);
  const [failed, setFailed] = useState(false);

  const choose = async (next: UiLocale) => {
    if (next === locale || pending) return;
    setFailed(false);
    setPending(next);
    try {
      await setLocale(next);
    } catch {
      // The store has already rolled back, so what is displayed matches
      // what was actually saved. Only the message is left to show.
      setFailed(true);
    } finally {
      setPending(null);
    }
  };

  return (
    <View style={styles.container}>
      <ThemedText type="smallBold">{t('settings.language.title')}</ThemedText>
      <ThemedText type="small" style={{ color: theme.textSecondary }}>
        {t('settings.language.description')}
      </ThemedText>

      <ThemedView type="backgroundElement" style={styles.list}>
        {UI_LOCALES.map((code) => {
          const selected = code === locale;
          return (
            <Pressable
              key={code}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: pending !== null }}
              disabled={pending !== null}
              onPress={() => choose(code)}
              style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
            >
              <ThemedText
                type="small"
                // Render each label in its own script's direction, so the
                // Arabic and Urdu entries read correctly inside a list that
                // is otherwise laid out left-to-right.
                style={{ writingDirection: code === 'ar' || code === 'ur' ? 'rtl' : 'ltr' }}
              >
                {LOCALE_LABELS[code]}
              </ThemedText>
              {pending === code ? (
                <ActivityIndicator size="small" color={theme.text} />
              ) : selected ? (
                <ThemedText type="smallBold">✓</ThemedText>
              ) : null}
            </Pressable>
          );
        })}
      </ThemedView>

      {failed ? (
        <ThemedText type="small" style={styles.error}>
          {t('settings.language.changeFailed')}
        </ThemedText>
      ) : null}

      {/* React Native flips layout direction natively and only on the next
          app start. Saying so plainly is the honest option: the alternative
          is a worker seeing Arabic text inside a left-to-right layout with
          no explanation for why it looks half-finished. */}
      {needsRestart ? (
        <ThemedText type="small" style={styles.notice}>
          {t('settings.language.restartRequired')}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.one,
  },
  list: {
    borderRadius: Spacing.two,
    overflow: 'hidden',
    marginTop: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  error: {
    color: '#E53E3E',
  },
  notice: {
    color: '#B7791F',
  },
});
