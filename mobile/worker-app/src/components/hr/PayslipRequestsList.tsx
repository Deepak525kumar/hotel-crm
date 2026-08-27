import { StyleSheet, ActivityIndicator, FlatList, RefreshControl, Pressable } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import type { PayslipRequestDto } from '@/types/api';
import { useTranslation } from 'react-i18next';

const STATUS_TONE: Record<PayslipRequestDto['status'], 'warning' | 'success'> = {
  // Tokens rather than hexes, resolved against the theme at render.
  REQUESTED: 'warning',
  FULFILLED: 'success',
};

export function PayslipRequestsList({
  requests,
  loading,
  refreshing,
  onRefresh,
  onRequestPayslip,
}: {
  requests: PayslipRequestDto[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onRequestPayslip: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  if (loading && !refreshing) {
    return <ActivityIndicator style={styles.loader} color={theme.text} />;
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedView style={styles.headerRow}>
        <ThemedText type="smallBold">{t('hr.payslipRequests')}</ThemedText>
        <Pressable onPress={onRequestPayslip} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
          <ThemedText type="smallBold" style={{ color: theme.primary }}>{t('hr.requestPayslip')}</ThemedText>
        </Pressable>
      </ThemedView>

      <FlatList
        data={requests}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => (
          <ThemedView type="backgroundElement" style={styles.itemCard}>
            <ThemedView style={styles.itemRow}>
              <ThemedText type="smallBold">
                {item.period_start} to {item.period_end}
              </ThemedText>
              <ThemedText 
                type="smallBold" 
                style={{ 
                  color: theme[STATUS_TONE[item.status]],
                  textTransform: 'capitalize'
                }}
              >
                {item.status.toLowerCase()}
              </ThemedText>
            </ThemedView>
            <ThemedText type="small" themeColor="textSecondary">
              Requested on: {new Date(item.created_at).toLocaleDateString()}
            </ThemedText>
          </ThemedView>
        )}
        ListEmptyComponent={
          <ThemedView type="backgroundElement" style={styles.empty}>
            <ThemedText type="smallBold" style={styles.emptyTitle}>{t("hr.noRequests")}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyDescription}>{t("hr.noPayslipsRequestedYet")}</ThemedText>
          </ThemedView>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.two,
  },
  loader: { marginTop: Spacing.six },
  list: { gap: Spacing.two, paddingBottom: Spacing.six },
  itemCard: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.one,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  empty: { borderRadius: Spacing.two, padding: Spacing.four, alignItems: 'center', gap: Spacing.one },
  emptyTitle: { textAlign: 'center' },
  emptyDescription: { textAlign: 'center' },
});
