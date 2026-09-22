import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';

import {
  BottomTabInset,
  Card,
  EmptyState,
  Input,
  MaxContentWidth,
  Radius,
  ScreenHeader,
  SectionHeader,
  Spacing,
  ThemedText,
  ThemedView,
  scopeOf,
  useAuthStore,
  useTheme,
} from '@hotel-crm/mobile-shared';

import { buildMenu, filterMenu } from '@/lib/more-menu';

/**
 * Everything the tab bar has no room for.
 *
 * GROUPED AND SEARCHABLE, not a flat list. The first version listed every
 * feature in one column with no structure, which the project owner flagged.
 * The pattern here follows what feature-heavy apps converge on — iOS
 * Settings, Salesforce, Workday: related items under group headers, a search
 * field once the list outgrows a screen, and icons only where they aid
 * recognition rather than as decoration.
 *
 * Search matters more than it looks: with ~15 destinations the list is two
 * scrolls long, and a manager who knows the word "payslip" should not have to
 * remember whether it lives under People or Money.
 *
 * Gating is the same as the screens behind each row. A row that opens a 403
 * is worse than an absent row — it teaches the manager the app is unreliable.
 */
export default function More() {
  const { t } = useTranslation();
  const theme = useTheme();
  const user = useAuthStore((s) => s.user);
  const scope = scopeOf(user);
  const [query, setQuery] = useState('');

  const groups = useMemo(
    () => buildMenu({ t, role: user?.role, scopeKind: scope.kind }),
    [t, user?.role, scope.kind]
  );
  const visible = useMemo(() => filterMenu(groups, query), [groups, query]);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScreenHeader title={t('nav.more')} />

          <Input
            value={query}
            onChangeText={setQuery}
            placeholder={t('common.search')}
            accessibilityLabel={t('common.search')}
          />

          {visible.length === 0 ? (
            <EmptyState title={t('common.none')} />
          ) : (
            visible.map((group) => (
              <View key={group.key} style={styles.group}>
                <SectionHeader title={group.title} />
                <Card>
                  {group.items.map((item, index) => (
                    <View key={item.route}>
                      {index > 0 ? (
                        <View style={[styles.divider, { backgroundColor: theme.border }]} />
                      ) : null}
                      <View
                        style={styles.rowWrap}
                        accessibilityRole="button"
                        accessibilityLabel={item.label}
                        onTouchEnd={() => router.push(item.route as never)}
                      >
                        <ThemedText style={styles.glyph}>{item.glyph}</ThemedText>
                        <View style={styles.text}>
                          <ThemedText type="smallBold" numberOfLines={1}>
                            {item.label}
                          </ThemedText>
                          {item.hint ? (
                            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                              {item.hint}
                            </ThemedText>
                          ) : null}
                        </View>
                        <ThemedText themeColor="textSecondary">›</ThemedText>
                      </View>
                    </View>
                  ))}
                </Card>
              </View>
            ))
          )}
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
    paddingBottom: BottomTabInset,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  group: { gap: Spacing.two },
  rowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 48,
    paddingVertical: Spacing.two,
  },
  glyph: { width: 26, textAlign: 'center' },
  text: { flex: 1, flexShrink: 1, minWidth: 0, gap: 1 },
  divider: { height: StyleSheet.hairlineWidth },
});
