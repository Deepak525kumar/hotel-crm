import { StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { api, ApiError } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import type { WorkerAssignment, Attendance, GeoCheckin } from '@/types/api';

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <ThemedView style={styles.infoRow} type="backgroundElement">
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText type="small">{value}</ThemedText>
    </ThemedView>
  );
}

export default function ShiftDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [shift, setShift] = useState<WorkerAssignment | null>(null);
  const [att, setAtt] = useState<Attendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [checkingLocation, setCheckingLocation] = useState(false);
  const [geoResult, setGeoResult] = useState<GeoCheckin | null>(null);

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

  const handleCheckIn = async () => {
    if (!shift) return;
    setActing(true);
    try {
      await api.attendance.checkIn(shift.id);
      await reload();
      Alert.alert('Checked In', 'You have successfully checked in.');
    } catch (err) {
      Alert.alert('Error', err instanceof ApiError ? err.message : 'Check-in failed.');
    } finally {
      setActing(false);
    }
  };

  // GD-14 (SPEC-GEO-001 TREQ-GEO-001/002/003): standalone geofence
  // verification -- informational only, does NOT gate handleCheckIn/
  // handleCheckOut above. backend-attendance's own checkIn() has no
  // coordinate field and no interface to call into backend-geo yet
  // (IF-GEO-DISTANCE-CHECK's contract into Attendance is "not yet
  // authored" per SPEC-GEO-001) -- wiring the two together is out of this
  // slice's scope. Location is sampled only when this button is pressed,
  // never continuously (RULE-GEO-002) -- no background/watch API is used.
  const handleVerifyLocation = async () => {
    const wr = shift?.work_request;
    if (!wr?.hotel_id) return;

    setCheckingLocation(true);
    setGeoResult(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location permission needed', 'Enable location access to verify you are at the hotel.');
        return;
      }

      const position = await Location.getCurrentPositionAsync({});
      const result = await api.geo.checkIn({
        hotel_id: wr.hotel_id,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      setGeoResult(result);
    } catch (err) {
      Alert.alert('Error', err instanceof ApiError ? err.message : 'Could not verify location.');
    } finally {
      setCheckingLocation(false);
    }
  };

  const handleCheckOut = async () => {
    if (!att?.id) return;
    setActing(true);
    try {
      await api.attendance.checkOut(att.id);
      await reload();
      Alert.alert('Checked Out', 'You have successfully checked out.');
    } catch (err) {
      Alert.alert('Error', err instanceof ApiError ? err.message : 'Check-out failed.');
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
        <ThemedText type="small" themeColor="textSecondary">Shift not found.</ThemedText>
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
            {wr?.position ?? 'Shift Details'}
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.section}>
            {wr ? (
              <>
                <InfoRow
                  label="Date"
                  value={new Date(wr.shift_date).toLocaleDateString('en-US', {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                  })}
                />
                <View style={styles.divider} />
                <InfoRow label="Time" value={`${wr.shift_start_time} – ${wr.shift_end_time}`} />
                <View style={styles.divider} />
              </>
            ) : null}
            <InfoRow label="Status" value={shift.status.replace(/_/g, ' ')} />
          </ThemedView>

          <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
            Attendance
          </ThemedText>
          <ThemedView type="backgroundElement" style={styles.section}>
            <InfoRow
              label="Check-in"
              value={att?.check_in_at ? new Date(att.check_in_at).toLocaleTimeString() : '—'}
            />
            <View style={styles.divider} />
            <InfoRow
              label="Check-out"
              value={att?.check_out_at ? new Date(att.check_out_at).toLocaleTimeString() : '—'}
            />
            {att?.status ? (
              <>
                <View style={styles.divider} />
                <InfoRow label="Attendance Status" value={att.status} />
              </>
            ) : null}
          </ThemedView>

          <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
            Location
          </ThemedText>
          <ThemedView type="backgroundElement" style={styles.section}>
            <InfoRow
              label="Geofence"
              value={
                geoResult
                  ? `${geoResult.inside_radius ? 'At hotel' : 'Not at hotel'} (~${Math.round(geoResult.distance_meters)}m)`
                  : 'Not checked yet'
              }
            />
          </ThemedView>
          <Pressable
            onPress={handleVerifyLocation}
            disabled={checkingLocation}
            style={({ pressed }) => [
              styles.verifyLocationBtn,
              { opacity: pressed || checkingLocation ? 0.7 : 1 },
            ]}
          >
            {checkingLocation ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <ThemedText type="smallBold" style={styles.btnText}>Verify Location</ThemedText>
            )}
          </Pressable>

          {canCheckIn && (
            <Pressable
              onPress={handleCheckIn}
              disabled={acting}
              style={({ pressed }) => [styles.checkInBtn, { opacity: pressed || acting ? 0.7 : 1 }]}
            >
              {acting ? <ActivityIndicator color="#fff" /> : (
                <ThemedText type="smallBold" style={styles.btnText}>Check In</ThemedText>
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
                <ThemedText type="smallBold" style={styles.btnText}>Check Out</ThemedText>
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
  verifyLocationBtn: { backgroundColor: '#3182CE', borderRadius: Spacing.two, height: 48, justifyContent: 'center', alignItems: 'center', marginBottom: Spacing.three },
  checkInBtn: { backgroundColor: '#38A169', borderRadius: Spacing.two, height: 48, justifyContent: 'center', alignItems: 'center', marginBottom: Spacing.two },
  checkOutBtn: { backgroundColor: '#DD6B20', borderRadius: Spacing.two, height: 48, justifyContent: 'center', alignItems: 'center', marginBottom: Spacing.three },
  btnText: { color: '#fff' },
});
