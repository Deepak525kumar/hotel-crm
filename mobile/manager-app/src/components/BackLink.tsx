import { Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ThemedText , Spacing , isRtlLocale , useLocaleStore } from '@hotel-crm/mobile-shared';

/**
 * "Back" affordance shared by every detail screen.
 *
 * The arrow is flipped here rather than left to React Native's layout
 * mirroring: the glyph is a literal character, so `I18nManager` never touches
 * it, and mirroring only takes effect on the next app start anyway. An Arabic
 * or Urdu reader would otherwise see an arrow pointing away from the direction
 * "back" runs in their script.
 *
 * Previously each of these screens carried its own `← Back` literal, which is
 * how the label stayed English through the first extraction pass.
 */
export function BackLink() {
  const { t } = useTranslation();
  const router = useRouter();
  const locale = useLocaleStore((s) => s.locale);
  const arrow = isRtlLocale(locale) ? '→' : '←';

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  return (
    <Pressable onPress={handleBack} style={styles.back}>
      <ThemedText type="small" themeColor="textSecondary">
        {arrow} {t('common.back')}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: { marginBottom: Spacing.two },
});
