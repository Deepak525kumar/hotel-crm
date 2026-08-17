import { StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { api, ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import type { WorkerAssignment, Attendance } from '@/types/api';
import { useTranslation } from 'react-i18next';

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <ThemedView style={styles.infoRow} type="backgroundElement">
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText type="small">{value}</ThemedText>
    </ThemedView>
  );
}

export default function ShiftDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [shift, setShift] = useState<WorkerAssignment | null>(null);
  const [att, setAtt] = useState<Attendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  // AssignmentDto does not embed attendance, so resolve it by assignment_id.
  // This survives app restart / navigation / reload because it is fetched
  // fresh from the backend each time the screen loads or an action completes.
  const loadAttendance = async (assignmentId: string) => {
    const records = await api.attendance.listByAssignment(assignmentId);
    setAtt(records[0] ?? null);
  };

  const reload = async () => {
    if (!id) return;
    const [assignment] = await Promise.all([
      api.assignments.get(id),
      loadAttendance(id),
    ]);
    setShift(assignment);
  };

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.assignments.get(id).then(setShift),
      loadAttendance(id),
    ]).finally(() => setLoading(false));
  }, [id]);

  // GD-14 (SPEC-GEO-001 TREQ-GEO-001/002/003): location is sampled as part of
  // Check In itself and sent with the same request, so backend-attendance's
  // geofence verification (IF-GEO-DISTANCE-CHECK via backend-geo) runs before
  // the check-in is committed -- there is no separate "Verify Location" step.
  // Location is sampled once per tap, never continuously (RULE-GEO-002) -- no
  // background/watch API is used. If location can't be obtained (permission
  // denied, no signal), the check-in request is still sent without
  // coordinates -- backend-attendance is the actual enforcement point and
  // will reject it with a clear message if this hotel has a geofence
  // configured (denying permission must not bypass the geofence); if the
  // hotel has none configured, the same omission is accepted as before.
  const handleCheckIn = async () => {
    if (!shift) return;
    setActing(true);
    try {
      let location: { latitude: number; longitude: number } | undefined;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const position = await Location.getCurrentPositionAsync({});
          location = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        }
      } catch {
        // Location sampling failed -- fall through; backend decides whether
        // this hotel requires it.
      }

      await api.attendance.checkIn(shift.id, location);
      await reload();
      Alert.alert(t('shifts.checkedIn'), t('shifts.checkInSuccess'));
    } catch (err) {
      Alert.alert(t('errors.title'), err instanceof ApiError ? err.message : t('shifts.checkInFailed'));
    } finally {
      setActing(false);
    }
  };

  const handleCheckOut = async () => {
    if (!att?.id) return;
    setActing(true);
    try {
      let location: { latitude: number; longitude: number } | undefined;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const position = await Location.getCurrentPositionAsync({});
          location = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        }
      } catch {
        // Location sampling failed -- fall through; backend decides whether
        // this hotel requires it.
      }

      await api.attendance.checkOut(att.id, location);
      await reload();
      Alert.alert(t('shifts.checkedOut'), t('shifts.checkOutSuccess'));
    } catch (err) {
      Alert.alert(t('errors.title'), err instanceof ApiError ? err.message : t('shifts.checkOutFailed'));
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!shift) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText type="small" themeColor="textSecondary">{t('shifts.notFound')}</ThemedText>
      </ThemedView>
    );
  }

  const wr = shift.work_request;
  const canCheckIn = ['CONFIRMED', 'IN_PROGRESS'].includes(shift.status) && !att?.check_in_at;
  const canCheckOut = !!(att?.check_in_at && !att?.check_out_at);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <ThemedText type="small" themeColor="textSecondary">← Back</ThemedText>
        </Pressable>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <ThemedText type="subtitle" style={styles.title}>
            {wr?.position ?? t('shifts.detailsTitle')}
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.section}>
            {wr ? (
              <>
                <InfoRow
                  label={t('fields.date')}
                  value={new Date(wr.shift_date).toLocaleDateString('en-US', {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                  })}
                />
                <View style={styles.divider} />
                <InfoRow label={t('fields.time')} value={`${wr.shift_start_time} – ${wr.shift_end_time}`} />
                <View style={styles.divider} />
              </>
            ) : null}
            <InfoRow label={t('fields.status')} value={shift.status.replace(/_/g, ' ')} />
          </ThemedView>

          <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>{t("nav.attendance")}</ThemedText>
          <ThemedView type="backgroundElement" style={styles.section}>
            <InfoRow
              label={t('shifts.checkIn')}
              value={att?.check_in_at ? new Date(att.check_in_at).toLocaleTimeString() : '—'}
            />
            <View style={styles.divider} />
            <InfoRow
              label={t('shifts.checkOut')}
              value={att?.check_out_at ? new Date(att.check_out_at).toLocaleTimeString() : '—'}
            />
            {att?.status ? (
              <>
                <View style={styles.divider} />
                <InfoRow label={t('shifts.attendanceStatus')} value={att.status} />
              </>
            ) : null}
          </ThemedView>

          {canCheckIn && (
            <Pressable
              onPress={handleCheckIn}
              disabled={acting}
              style={({ pressed }) => [styles.checkInBtn, { opacity: pressed || acting ? 0.7 : 1 }]}
            >
              {acting ? <ActivityIndicator color="#fff" /> : (
                <ThemedText type="smallBold" style={styles.btnText}>{t('shifts.checkIn')}</ThemedText>
              )}
            </Pressable>
          )}

          {canCheckOut && (
            <Pressable
              onPress={handleCheckOut}
              disabled={acting}
              style={({ pressed }) => [styles.checkOutBtn, { opacity: pressed || acting ? 0.7 : 1 }]}
            >
              {acting ? <ActivityIndicator color="#fff" /> : (
                <ThemedText type="smallBold" style={styles.btnText}>{t('shifts.checkOut')}</ThemedText>
              )}
            </Pressable>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, paddingTop: Spacing.four },
  back: { marginBottom: Spacing.three },
  scroll: { paddingBottom: Spacing.six },
  title: { marginBottom: Spacing.three },
  section: { borderRadius: Spacing.two, overflow: 'hidden', marginBottom: Spacing.three },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.three, paddingVertical: Spacing.three },
  divider: { height: 1, backgroundColor: '#E0E1E6', marginHorizontal: Spacing.three },
  sectionLabel: { marginBottom: Spacing.two, textTransform: 'uppercase', letterSpacing: 0.8 },
  checkInBtn: { backgroundColor: '#38A169', borderRadius: Spacing.two, height: 48, justifyContent: 'center', alignItems: 'center', marginBottom: Spacing.two },
  checkOutBtn: { backgroundColor: '#DD6B20', borderRadius: Spacing.two, height: 48, justifyContent: 'center', alignItems: 'center', marginBottom: Spacing.three },
  btnText: { color: '#fff' },
});
