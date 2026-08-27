import { StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, View, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { getCoordinatesIfAvailable } from '@/lib/optional-location';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { api } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import type { WorkerAssignment, AttendanceRecord } from '@/types/api';
import { useTranslation } from 'react-i18next';
import { BackLink } from '@/components/BackLink';
import { translateApiError } from '../../lib/api-error-i18n';
import { formatHotelAddress, hasCoordinates, mapsUrlFor, type MapPlatform } from '@/lib/map-link';

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
  const [att, setAtt] = useState<AttendanceRecord | null>(null);
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
      // Undefined when the module, the permission or the fix is unavailable;
      // the backend decides whether this hotel requires coordinates.
      const location = await getCoordinatesIfAvailable();

      await api.attendance.checkIn(shift.id, location);
      await reload();
      Alert.alert(t('shifts.checkedIn'), t('shifts.checkInSuccess'));
    } catch (err) {
      Alert.alert(t('errors.title'), translateApiError(err, t, 'shifts.checkInFailed'));
    } finally {
      setActing(false);
    }
  };

  const handleCheckOut = async () => {
    if (!att?.id) return;
    setActing(true);
    try {
      // Undefined when the module, the permission or the fix is unavailable;
      // the backend decides whether this hotel requires coordinates.
      const location = await getCoordinatesIfAvailable();

      await api.attendance.checkOut(att.id, location);
      await reload();
      Alert.alert(t('shifts.checkedOut'), t('shifts.checkOutSuccess'));
    } catch (err) {
      Alert.alert(t('errors.title'), translateApiError(err, t, 'shifts.checkOutFailed'));
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
  const hotel = shift.hotel ?? null;
  // shift.day is the authoritative calendar day (YYYY-MM-DD, always present);
  // work_request.shift_date only exists for request-backed shifts.
  const dayIso = shift.day ?? wr?.shift_date ?? null;
  const shiftDay = dayIso
    ? new Date(dayIso).toLocaleDateString(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      })
    : null;

  const openDirections = async () => {
    if (!hotel) return;
    const platform: MapPlatform =
      Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
    const url = mapsUrlFor(hotel, platform);
    try {
      await Linking.openURL(url);
    } catch {
      // A device with no map app at all: tell the worker rather than failing
      // silently, and leave the address on screen above to copy.
      Alert.alert(t('errors.title'), t('shifts.mapsUnavailable', 'No map app is available on this device.'));
    }
  };

  const canCheckIn = ['CONFIRMED', 'IN_PROGRESS'].includes(shift.status) && !att?.check_in_at;
  const canCheckOut = !!(att?.check_in_at && !att?.check_out_at);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <BackLink />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <ThemedText type="subtitle" style={styles.title}>
            {wr?.position ?? t('shifts.detailsTitle')}
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.section}>
            {/* Read from the assignment itself, not from work_request. Every
                assignment in production is calendar-placed, so work_request is
                null and this card used to render nothing but the status — the
                worker could not see where or when their shift was. */}
            {hotel?.name && (
              <>
                <InfoRow label={t('jobs.hotel')} value={hotel.name} />
                <View style={styles.divider} />
              </>
            )}
            {hotel && (
              <>
                <InfoRow label={t('jobs.location')} value={formatHotelAddress(hotel)} />
                <View style={styles.divider} />
              </>
            )}
            {shiftDay && (
              <>
                <InfoRow label={t('fields.date')} value={shiftDay} />
                <View style={styles.divider} />
              </>
            )}
            {/* Times exist only for JobRequest-backed shifts; a calendar
                placement has a day and no times, so the row is omitted rather
                than showing "null – null". */}
            {shift.shift_start_time && shift.shift_end_time && (
              <>
                <InfoRow label={t('fields.time')} value={`${shift.shift_start_time} – ${shift.shift_end_time}`} />
                <View style={styles.divider} />
              </>
            )}
            {wr?.position && (
              <>
                <InfoRow label={t('jobs.position', 'Position')} value={wr.position} />
                <View style={styles.divider} />
              </>
            )}
            {hotel?.timezone && (
              <>
                <InfoRow label={t('fields.timezone', 'Timezone')} value={hotel.timezone} />
                <View style={styles.divider} />
              </>
            )}
            {shift.assigned_by_name && (
              <>
                <InfoRow label={t('shifts.assignedBy', 'Assigned by')} value={shift.assigned_by_name} />
                <View style={styles.divider} />
              </>
            )}
            {wr?.description && (
              <>
                <View style={styles.infoRowColumn}>
                  <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.one }}>{t('jobs.description')}</ThemedText>
                  <ThemedText type="small">{wr.description}</ThemedText>
                </View>
                <View style={styles.divider} />
              </>
            )}
            <InfoRow label={t('fields.status')} value={shift.status.replace(/_/g, ' ')} />
          </ThemedView>

          {/* Getting there. An address-based link, because no hotel has
              coordinates yet; mapsUrlFor prefers them automatically once they
              exist. */}
          {hotel && (
            <ThemedView type="backgroundElement" style={styles.section}>
              <Pressable
                accessibilityRole="button"
                onPress={() => void openDirections()}
                style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.7 : 1 }]}
              >
                <ThemedText type="smallBold">
                  {t('shifts.openInMaps', 'Open in Maps')}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {hasCoordinates(hotel)
                    ? t('shifts.exactLocation', 'Exact location')
                    : t('shifts.addressSearch', 'By address')}
                </ThemedText>
              </Pressable>
              {hotel.contact_phone && (
                <>
                  <View style={styles.divider} />
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void Linking.openURL(`tel:${hotel.contact_phone}`)}
                    style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <ThemedText type="smallBold">{t('shifts.callHotel', 'Call hotel')}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{hotel.contact_phone}</ThemedText>
                  </Pressable>
                </>
              )}
              {hotel.contact_email && (
                <>
                  <View style={styles.divider} />
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void Linking.openURL(`mailto:${hotel.contact_email}`)}
                    style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <ThemedText type="smallBold">{t('shifts.emailHotel', 'Email hotel')}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{hotel.contact_email}</ThemedText>
                  </Pressable>
                </>
              )}
            </ThemedView>
          )}

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
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, paddingTop: Spacing.four },
  back: { marginBottom: Spacing.three },
  scroll: { paddingBottom: Spacing.six },
  title: { marginBottom: Spacing.three },
  section: { borderRadius: Spacing.two, overflow: 'hidden', marginBottom: Spacing.three },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.three, paddingVertical: Spacing.three },
  infoRowColumn: { flexDirection: 'column', paddingHorizontal: Spacing.three, paddingVertical: Spacing.three },
  divider: { height: 1, backgroundColor: '#E0E1E6', marginHorizontal: Spacing.three },
  sectionLabel: { marginBottom: Spacing.two, textTransform: 'uppercase', letterSpacing: 0.8 },
  checkInBtn: { backgroundColor: '#38A169', borderRadius: Spacing.two, height: 48, justifyContent: 'center', alignItems: 'center', marginBottom: Spacing.two },
  checkOutBtn: { backgroundColor: '#DD6B20', borderRadius: Spacing.two, height: 48, justifyContent: 'center', alignItems: 'center', marginBottom: Spacing.three },
  btnText: { color: '#fff' },
});
