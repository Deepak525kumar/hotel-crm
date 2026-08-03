import { StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuthStore } from '@/stores/auth-store';
import { Spacing } from '@/constants/theme';
import { api, ApiError } from '@/lib/api';
import { ContractStatusCard } from '@/components/hr/ContractStatusCard';
import { PayslipRequestsList } from '@/components/hr/PayslipRequestsList';
import type { ContractDto, PayslipRequestDto } from '@/types/api';

export default function HRScreen() {
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
      setLoadError(error instanceof ApiError ? error.message : 'Could not load HR data.');
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

    Alert.alert(
      'Request Payslip',
      `Would you like to request your payslip for ${firstDay.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Request', 
          onPress: async () => {
            try {
              await api.hr.requestPayslip({
                period_start: start,
                period_end: end
              });
              load(); // Reload to show the new request
            } catch (error) {
              Alert.alert('Error', error instanceof ApiError ? error.message : 'Failed to request payslip');
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
        <Pressable onPress={() => router.back()} style={styles.back}>
          <ThemedText type="small" themeColor="textSecondary">
            ← Back
          </ThemedText>
        </Pressable>
        
        <ThemedText type="subtitle" style={styles.header}>
          HR & Payroll
        </ThemedText>

        {loadError && (
          <ThemedText type="small" style={styles.errorText}>
            {loadError}
          </ThemedText>
        )}

        <ThemedText type="smallBold" style={styles.sectionTitle}>
          Contract Status
        </ThemedText>
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
