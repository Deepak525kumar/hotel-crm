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
import { Badge, Button } from '@/components/ui';
import { attendanceStatusTone } from '@/lib/attendance-status-tone';

function formatDateTime(iso: string | null): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

function InfoRow({ label, value, color }: { label: string; value: string; color?: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}>
      <Text style={{ color: theme.textSecondary, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: color ?? theme.text, fontSize: 14, fontWeight: '500' }}>{value}</Text>
    </View>
  );
}


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
          // The live inspection flow (2026-08-30). This used to open
          // /quality/[id], a second writer that captured no checklist and no
          // complete/rework decision; that screen is gone.
          onPress: () =>
            router.push({
              pathname: '/rating/[id]',
              params: { id: record!.assignment_id, worker_id: record!.worker_id },
            }),
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

    verifiedBanner: {
      backgroundColor: theme.successSubtle,
      borderRadius: 10,
      padding: 12,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
    },
    verifiedText: { color: theme.success, fontWeight: '700', fontSize: 15 },
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
      backgroundColor: theme.primary,
      borderRadius: 12,
      padding: 16,
      alignItems: 'center',
      marginTop: 12,
    },
    buttonText: { color: theme.onPrimary, fontSize: 16, fontWeight: '700' },
    action: { marginTop: 8 },
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
          <Badge
            label={t(`attendance.status${record.status}`, record.status)}
            tone={attendanceStatusTone(record.status)}
          />
          <View style={styles.divider} />
          {/* Who and where. The DTO used to carry only ids, so this screen
              showed times and a status with no indication of whose shift it
              was. */}
          {record.worker && (
            <InfoRow
              label={t('fields.worker', 'Worker')}
              value={`${record.worker.first_name} ${record.worker.last_name}`.trim()}
            />
          )}
          {record.hotel && (
            <InfoRow
              label={t('fields.hotel')}
              value={[record.hotel.name, record.hotel.city].filter(Boolean).join(' · ')}
            />
          )}
          {record.verified_by_name && (
            <InfoRow label={t('attendance.verifiedBy', 'Verified by')} value={record.verified_by_name} />
          )}
          <InfoRow label={t("shifts.checkIn")} value={formatDateTime(record.check_in_at)} />
          <InfoRow label={t("shifts.checkOut")} value={formatDateTime(record.check_out_at)} />
          <InfoRow label={t("attendance.expectedStart")} value={formatDateTime(record.expected_start)} />
          <InfoRow label={t("attendance.expectedEnd")} value={formatDateTime(record.expected_end)} />
          {record.minutes_late !== null && (
            <InfoRow
              label={t("attendance.minutesLate")}
              value={`${record.minutes_late}m`}
              color={record.minutes_late > 0 ? theme.warning : theme.success}
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
                <ActivityIndicator color={theme.onPrimary} />
              ) : (
                <Text style={styles.buttonText}>{t("attendance.verifyTitleAction")}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* ONE record, one button (2026-08-30). This offered two -- "quality
            check" to /quality/[id] and "rate worker" to /rating/[id] -- back
            when a verification and a rating were separate rows. They were
            merged into QualityVerification on 2026-08-29, so the two buttons
            wrote the same record by two different paths, and only one of them
            captured the checklist and the complete/rework decision. The other
            screen has been deleted; this is the inspection flow. */}
        <Button
          label={t('quality.rateWorker')}
          variant="secondary"
          onPress={() =>
            router.push({
              pathname: '/rating/[id]',
              params: { id: record.assignment_id, worker_id: record.worker_id },
            })
          }
          style={styles.action}
        />

        {/* The separate "Rate Worker" screen was retired on 2026-08-24. It
            was a 1-5 star picker (score x 20) writing to the Rating model,
            which contradicted CRR §15's "Quality score is 0-100 (not a
            5-star system)" and collected no photo evidence -- so it was the
            one path that could move a worker's leaderboard standing with
            nothing backing it. Quality Verification above is the checker's
            single rating path: free 0-100 score, photo required. */}
      </ScrollView>
    </>
  );
}
