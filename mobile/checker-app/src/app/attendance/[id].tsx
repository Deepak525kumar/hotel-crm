import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
  TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { api } from '@/lib/api';
import type { AttendanceRecord } from '@/types/api';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from 'react-i18next';

function formatDateTime(iso: string | null): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

function InfoRow({ label, value, color }: { label: string; value: string; color?: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}>
      <Text style={{ color: theme.textSecondary, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: color ?? theme.text, fontSize: 14, fontWeight: '500' }}>{value}</Text>
    </View>
  );
}

const STATUS_COLORS: Record<string, string> = {
  PRESENT: '#22c55e',
  LATE: '#f59e0b',
  ABSENT: '#ef4444',
  EXPECTED: '#94a3b8',
  PARTIAL: '#a78bfa',
};

export default function AttendanceDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const [record, setRecord] = useState<AttendanceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    api.attendance.get(id).then(setRecord).finally(() => setLoading(false));
  }, [id]);

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const updated = await api.attendance.verify(id, notes || undefined);
      setRecord(updated);
      Alert.alert(t("attendance.verifiedMark"), t('attendance.verifiedBody'), [
        {
          text: t('nav.qualityCheck'),
          onPress: () => router.push(`/quality/${record!.assignment_id}`),
        },
        { text: t('common.done'), style: 'cancel' },
      ]);
    } catch (e: any) {
      Alert.alert(t("errors.title"), e.message ?? t('attendance.verifyFailed'));
    } finally {
      setVerifying(false);
    }
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    content: { padding: 16, gap: 12 },
    card: { backgroundColor: theme.backgroundElement, borderRadius: 14, padding: 16 },
    sectionTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: theme.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 10,
    },
    divider: { height: 1, backgroundColor: theme.background, marginVertical: 2 },
    badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
    badgeText: { fontSize: 13, fontWeight: '700', color: '#fff' },
    verifiedBanner: {
      backgroundColor: '#dcfce7',
      borderRadius: 10,
      padding: 12,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
    },
    verifiedText: { color: '#166534', fontWeight: '700', fontSize: 15 },
    notesInput: {
      backgroundColor: theme.background,
      borderRadius: 10,
      padding: 12,
      color: theme.text,
      fontSize: 14,
      minHeight: 80,
      textAlignVertical: 'top',
      marginTop: 8,
    },
    button: {
      backgroundColor: '#3b82f6',
      borderRadius: 12,
      padding: 16,
      alignItems: 'center',
      marginTop: 12,
    },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    outlineButton: {
      borderRadius: 12,
      padding: 16,
      alignItems: 'center',
      borderWidth: 1.5,
    },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  });

  if (loading || !record) {
    return (
      <View style={[styles.container, styles.loading]}>
        <ActivityIndicator size="large" color={theme.text} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: t('nav.attendanceDetail'), headerShown: true }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t("fields.status")}</Text>
          <View style={[styles.badge, { backgroundColor: STATUS_COLORS[record.status] ?? '#94a3b8' }]}>
            <Text style={styles.badgeText}>{record.status}</Text>
          </View>
          <View style={styles.divider} />
          <InfoRow label={t("shifts.checkIn")} value={formatDateTime(record.check_in_at)} />
          <InfoRow label={t("shifts.checkOut")} value={formatDateTime(record.check_out_at)} />
          <InfoRow label={t("attendance.expectedStart")} value={formatDateTime(record.expected_start)} />
          <InfoRow label={t("attendance.expectedEnd")} value={formatDateTime(record.expected_end)} />
          {record.minutes_late !== null && (
            <InfoRow
              label={t("attendance.minutesLate")}
              value={`${record.minutes_late}m`}
              color={record.minutes_late > 0 ? '#f59e0b' : '#22c55e'}
            />
          )}
          {record.minutes_worked !== null && (
            <InfoRow label={t("attendance.minutesWorked")} value={`${record.minutes_worked}m`} />
          )}
        </View>

        {record.is_verified ? (
          <View style={styles.verifiedBanner}>
            <Text style={styles.verifiedText}>✓ Attendance Verified</Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t("attendance.verifyTitleAction")}</Text>
            <TextInput
              style={styles.notesInput}
              placeholder={t("attendance.verificationNotesPlaceholder")}
              placeholderTextColor={theme.textSecondary}
              value={notes}
              onChangeText={setNotes}
              multiline
            />
            <TouchableOpacity
              style={[styles.button, verifying && { opacity: 0.6 }]}
              onPress={handleVerify}
              disabled={verifying}
            >
              {verifying ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{t("attendance.verifyTitleAction")}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={[styles.outlineButton, { borderColor: '#7c3aed' }]}
          onPress={() => router.push(`/quality/${record.assignment_id}`)}
        >
          <Text style={{ color: '#7c3aed', fontSize: 15, fontWeight: '600' }}>
            Quality Verification →
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.outlineButton, { borderColor: '#f59e0b' }]}
          onPress={() =>
            router.push(`/rating/${record.assignment_id}?worker_id=${record.worker_id}`)
          }
        >
          <Text style={{ color: '#f59e0b', fontSize: 15, fontWeight: '600' }}>
            Rate Worker →
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}
