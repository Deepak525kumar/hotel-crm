import { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Pressable,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import useSWR from 'swr';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { api, translateApiError } from '@/lib/api';
import type { AttendanceRecord } from '@/types/api';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/auth-store';
import { Spacing } from '@/constants/theme';
import { ContractStatusCard } from '@/components/hr/ContractStatusCard';

function statusColor(status: string): string {
  switch (status) {
    case 'PRESENT': return '#22c55e';
    case 'LATE': return '#f59e0b';
    case 'ABSENT': return '#ef4444';
    default: return '#94a3b8';
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function QueueScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuthStore();
  const [submitting, setSubmitting] = useState(false);

  const { data: recordsData, error: recordsError, isLoading: recordsLoading, isValidating: recordsValidating, mutate: mutateRecords } = useSWR(
    user ? `/attendance/list/${user.id}` : null,
    () => api.attendance.list({ is_verified: false, per_page: 50 })
  );
  
  const { data: contractData, error: contractError, isLoading: contractLoading, isValidating: contractValidating, mutate: mutateContract } = useSWR(
    user?.employment_status === 'PENDING' ? `/hr/contract/${user.id}` : null,
    () => api.hr.getContractStatus(user.id)
  );

  const rawRecords = recordsData?.data ?? [];
  const records = rawRecords.filter((r) => r.status !== 'EXPECTED');
  const loading = recordsLoading || contractLoading;
  const refreshing = recordsValidating || contractValidating;
  const contract = contractData || null;
  const error = recordsError || contractError ? t('common.loadFailed') : null;

  const onRefresh = async () => {
    await Promise.all([mutateRecords(), mutateContract()]);
  };

  const handleSubmitForReview = async () => {
    if (!user) return;
    setSubmitting(true);
    try {
      await api.employee.submitForReview(user.id);
      Alert.alert(t('common.success', 'Success'), t('onboarding.submittedForReview', 'Your application has been submitted for review.'));
      await onRefresh();
    } catch (e: any) {
      Alert.alert(t('errors.title'), translateApiError(e, t, 'errors.generic'));
    } finally {
      setSubmitting(false);
    }
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
    headerTitle: { fontSize: 24, fontWeight: '700', color: theme.text },
    headerSubtitle: { fontSize: 14, color: theme.textSecondary, marginTop: 4 },
    statsRow: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
    statCard: {
      flex: 1,
      backgroundColor: theme.backgroundElement,
      borderRadius: 16,
      padding: 12,
      alignItems: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    },
    statNum: { fontSize: 22, fontWeight: '700', color: theme.text },
    statLabel: { fontSize: 11, color: theme.textSecondary, marginTop: 2 },
    card: {
      backgroundColor: theme.backgroundElement,
      borderRadius: 16,
      padding: 14,
      marginHorizontal: 16,
      marginBottom: 8,
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    },
    cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    workerLabel: { fontSize: 15, fontWeight: '600', color: theme.text },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    badgeText: { fontSize: 12, fontWeight: '600', color: '#fff' },
    cardSub: { fontSize: 13, color: theme.textSecondary, marginTop: 4 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
    emptyText: { fontSize: 16, color: theme.textSecondary, textAlign: 'center' },
    errorText: { color: '#ef4444', textAlign: 'center', padding: 16, fontSize: 14 },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  });

  const renderItem = ({ item, index }: { item: AttendanceRecord; index: number }) => (
    <Animated.View entering={FadeInUp.delay((index + 2) * 100)}>
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/attendance/${item.id}`)}
        activeOpacity={0.7}
      >
        <View style={styles.cardRow}>
          <Text style={styles.workerLabel}>Worker ···{item.worker_id.slice(-6)}</Text>
          <View style={[styles.badge, { backgroundColor: statusColor(item.status) }]}>
            <Text style={styles.badgeText}>{item.status}</Text>
          </View>
        </View>
        <Text style={styles.cardSub}>
          In: {formatTime(item.check_in_at)} · Out: {formatTime(item.check_out_at)}
          {item.minutes_late ? ` · ${item.minutes_late}m late` : ''}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );

  if (loading && !refreshing) {
    return (
      <View style={[styles.container, styles.loading]}>
        <ActivityIndicator size="large" color={theme.text} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t("attendance.queueTitle")}</Text>
        <Text style={styles.headerSubtitle}>{records.length} pending verification</Text>
      </View>

      {user?.employment_status === 'PENDING' && (
        <View style={[{ borderColor: '#D69E2E', borderWidth: 1, marginHorizontal: 16, marginBottom: 16, padding: 16, borderRadius: 12, backgroundColor: theme.backgroundElement }]}>
          <Text style={{ color: '#D69E2E', marginBottom: Spacing.one, fontWeight: '600' }}>Onboarding Incomplete</Text>
          <Text style={{ color: theme.textSecondary, marginBottom: Spacing.three, fontSize: 13 }}>
            Please ensure all your documents are uploaded and your contract is signed. Once everything is ready, submit your profile for review.
          </Text>
          
          <Pressable
            onPress={handleSubmitForReview}
            disabled={submitting}
            style={({ pressed }) => [
              { backgroundColor: '#D69E2E', opacity: pressed || submitting ? 0.7 : 1, padding: 12, borderRadius: 8, alignItems: 'center', marginBottom: 12 }
            ]}
          >
            <Text style={{ color: '#fff', fontWeight: '600' }}>
              {submitting ? 'Submitting...' : 'Submit for Review'}
            </Text>
          </Pressable>
          
          <ContractStatusCard contract={contract} loading={loading} />
        </View>
      )}

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{records.filter((r) => r.status === 'PRESENT').length}</Text>
          <Text style={styles.statLabel}>{t("status.present")}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{records.filter((r) => r.status === 'LATE').length}</Text>
          <Text style={styles.statLabel}>{t("status.late")}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{records.filter((r) => r.status === 'ABSENT').length}</Text>
          <Text style={styles.statLabel}>{t("status.absent")}</Text>
        </View>
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <FlatList
        data={records}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={records.length === 0 ? { flex: 1 } : undefined}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.text}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              All caught up!{'\n'}No attendance records pending verification.
            </Text>
          </View>
        }
      />
    </View>
  );
}
