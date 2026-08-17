import { StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuthStore } from '@/stores/auth-store';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { ContractStatusCard } from '@/components/hr/ContractStatusCard';
import { PayslipRequestsList } from '@/components/hr/PayslipRequestsList';
import type { ContractDto, PayslipRequestDto } from '@/types/api';
import { useTranslation } from 'react-i18next';
import { BackLink } from '@/components/BackLink';
import { translateApiError } from '../lib/api-error-i18n';

export default function HRScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { user } = useAuthStore();

  const [contract, setContract] = useState<ContractDto | null>(null);
  const [requests, setRequests] = useState<PayslipRequestDto[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoadError(null);
    try {
      const [contractData, requestsData] = await Promise.all([
        api.hr.getContractStatus(user.id),
        api.hr.listPayroll(),
      ]);
      setContract(contractData);
      setRequests(Array.isArray(requestsData) ? requestsData : []);
    } catch (error) {
      setLoadError(translateApiError(error, t, 'hr.dataLoadFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const handleRequestPayslip = () => {
    if (!user) return;

    // Default to last month
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);

    const start = firstDay.toISOString().split('T')[0];
    const end = lastDay.toISOString().split('T')[0];

    Alert.alert(t("hr.requestPayslip"),
      // Month name follows the CHOSEN ui language, not the device locale:
      // passing `undefined` here rendered a German month inside an Arabic
      // sentence for anyone whose phone and app language disagree.
      t('hr.payslipConfirm', {
        period: firstDay.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' }),
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.request'),
          onPress: async () => {
            try {
              await api.hr.requestPayslip({
                period_start: start,
                period_end: end
              });
              load(); // Reload to show the new request
            } catch (error) {
              Alert.alert(t("errors.title"), translateApiError(error, t, 'hr.payslipRequestFailed'));
            }
          }
        }
      ]
    );
  };

  if (!user) return null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <BackLink />

        <ThemedText type="subtitle" style={styles.header}>{t("hr.title")}</ThemedText>

        {loadError && (
          <ThemedText type="small" style={styles.errorText}>
            {loadError}
          </ThemedText>
        )}

        <ThemedText type="smallBold" style={styles.sectionTitle}>{t("hr.contractStatus")}</ThemedText>
        <ContractStatusCard contract={contract} loading={loading} />

        <PayslipRequestsList
          requests={requests}
          loading={loading}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onRequestPayslip={handleRequestPayslip}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, paddingTop: Spacing.four },
  back: { marginBottom: Spacing.two },
  header: { marginBottom: Spacing.three },
  sectionTitle: { marginBottom: Spacing.two },
  errorText: { color: '#E53E3E', marginBottom: Spacing.two },
});
