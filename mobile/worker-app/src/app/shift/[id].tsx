import { StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, View, Linking, Platform, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { getCoordinatesIfAvailable } from '@/lib/optional-location';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { api } from '@/lib/api';
import { Spacing } from '@/constants/theme';
import type { WorkerAssignment, Attendance, QualityCheck } from '@/types/api';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from 'react-i18next';
import { BackLink } from '@/components/BackLink';
import { translateApiError } from '../../lib/api-error-i18n';
import { formatHotelAddress, hasCoordinates, mapsUrlFor, type MapPlatform } from '@/lib/map-link';
import { matchesCheck, SEARCH_THRESHOLD } from '@/lib/check-search';

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <ThemedView style={styles.infoRow} type="backgroundElement">
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText type="small">{value}</ThemedText>
    </ThemedView>
  );
}

/**
 * The checks a checker recorded against this shift.
 *
 * Owner decision, 2026-08-29: the worker used to see only the shift's own
 * details, with no sign of whether anyone had inspected the rooms or what they
 * found. Tapping one opens the same detail screen the checker sees.
 */
function CheckRow({ check, onPress }: { check: QualityCheck; onPress: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  // Newest round number, or 0 when the server predates rounds.
  const rounds = check.rework_rounds?.length ?? 0;
  const newest = check.rework_rounds?.[check.rework_rounds.length - 1] ?? null;
  // A round cancelled after three days is closed but was never done. Without
  // this the row said "round N in progress" forever for work that had been
  // written off and taken off the schedule.
  const cancelled = !!newest?.cancelled_at;
  // ...and one that is waiting for the worker to be back on site is not
  // "in progress" either: no clock is running.
  const waiting = !cancelled && !newest?.completed_at && !newest?.timer_started_at;

  const tone =
    check.status === 'PASSED'
      ? theme.success
      : check.status === 'NEEDS_REWORK'
        ? theme.warning
        : theme.danger;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [checkStyles.row, { opacity: pressed ? 0.7 : 1, borderColor: theme.border }]}
    >
      <View style={checkStyles.left}>
        <ThemedText type="smallBold">
          {t('quality.roomLabel')} {check.room_number}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {check.checked_by
            ? `${t('quality.checkedBy')} ${check.checked_by.first_name}`
            : ''}
        </ThemedText>
        {/* Rework is the reason a worker opens this list, so it is called out
            rather than left to be inferred from the status word. */}
        {/* Rework state, both directions (owner decision, 2026-08-30). This
            showed only the PENDING case, so a worker who had finished their
            rework saw the row fall silent -- indistinguishable from a room
            that was never sent back. The round number is included because a
            room can now be sent back more than once, and "completed" without
            it does not say WHICH attempt finished. */}
        {check.rework_required && cancelled ? (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {t('quality.reworkCancelled')}
          </ThemedText>
        ) : check.rework_required && waiting ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t('quality.reworkWaitingOnSite')}
          </ThemedText>
        ) : check.rework_required && !check.rework_completed_at ? (
          <ThemedText type="small" style={{ color: theme.warning }}>
            {rounds > 0 ? t('quality.reworkRoundOpenShort', { number: rounds }) : t('quality.reworkPending')}
          </ThemedText>
        ) : check.rework_required && check.rework_completed_at ? (
          <ThemedText type="small" style={{ color: theme.success }}>
            {rounds > 0
              ? t('quality.reworkRoundCompletedShort', { number: rounds })
              : t('quality.reworkCompleted')}
          </ThemedText>
        ) : null}
      </View>
      <View style={checkStyles.right}>
        <ThemedText type="smallBold" style={{ color: tone }}>
          {check.score}
        </ThemedText>
        <ThemedText type="small" style={{ color: tone }}>
          {check.status === 'PASSED' && (check.rework_rounds?.length ?? 0) > 0
            ? 'Rework completed'
            : check.status.replace(/_/g, ' ')}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const checkStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  left: { flex: 1, gap: 2 },
  right: { alignItems: 'flex-end' },
});

export default function ShiftDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [shift, setShift] = useState<WorkerAssignment | null>(null);
  const [att, setAtt] = useState<Attendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [checks, setChecks] = useState<QualityCheck[] | null>(null);
  const [checkQuery, setCheckQuery] = useState('');
  const theme = useTheme();

  // Filtered here rather than inside the JSX so the "no matches" branch below
  // can tell an empty search result apart from a shift nobody has checked.
  const visibleChecks = (checks ?? []).filter((c) =>
    matchesCheck(c, checkQuery, t(`quality.outcome${c.status}`))
  );

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

  // Fetched separately from the shift itself and tolerant of failure: the
  // check list is additional context, and a worker who cannot load it must
  // still be able to check in and out. `null` means "not loaded", which the
  // section below renders as nothing rather than as "no checks yet".
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void api.quality
      .checksForAssignment(id)
      .then((res) => {
        if (!cancelled) setChecks(res.checks ?? []);
      })
      .catch(() => {
        if (!cancelled) setChecks(null);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

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

          {/* The checks recorded against this shift. Owner decision,
              2026-08-29: the worker sees every inspection of their own work,
              passed or sent back, and opens one to the same screen the checker
              sees. Hidden entirely while unloaded, so a failed fetch never
              reads as "nobody has checked this". */}
          {checks && checks.length > 0 ? (
            <>
              <ThemedText type="smallBold" style={styles.title}>
                {t('quality.checksTitle')}
              </ThemedText>
              {/* The box appears only once the list is long enough to need it
                  (owner decision, 2026-08-30: search where there are multiple
                  entries). On a three-room shift it is clutter; at ~100 rooms
                  scrolling to find room 412 is the entire problem. Filtered on
                  the device rather than over the network -- these checks are
                  already loaded, so a round-trip would only add latency to
                  every keystroke. */}
              {checks.length > SEARCH_THRESHOLD ? (
                <TextInput
                  style={[
                    styles.search,
                    { backgroundColor: theme.backgroundElement, color: theme.text },
                  ]}
                  placeholder={t('quality.searchChecksPlaceholder')}
                  placeholderTextColor={theme.textSecondary}
                  value={checkQuery}
                  onChangeText={setCheckQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                />
              ) : null}
              <ThemedView type="backgroundElement" style={styles.section}>
                {visibleChecks.length > 0 ? (
                  visibleChecks.map((check) => (
                    <CheckRow
                      key={check.id}
                      check={check}
                      onPress={() => router.push(`/check/${check.id}`)}
                    />
                  ))
                ) : (
                  /* Distinct from "nobody has checked this shift" below: the
                     checks exist, this search just does not match them. */
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    style={styles.searchEmpty}
                  >
                    {t('quality.searchChecksNoMatch')}
                  </ThemedText>
                )}
              </ThemedView>
            </>
          ) : checks && checks.length === 0 ? (
            <>
              <ThemedText type="smallBold" style={styles.title}>
                {t('quality.checksTitle')}
              </ThemedText>
              <ThemedView type="backgroundElement" style={styles.section}>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('quality.checksNoneBody')}
                </ThemedText>
              </ThemedView>
            </>
          ) : null}
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
  search: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginBottom: Spacing.two,
    fontSize: 15,
  },
  searchEmpty: { padding: Spacing.three },
  section: { borderRadius: Spacing.two, overflow: 'hidden', marginBottom: Spacing.three },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.three, paddingVertical: Spacing.three },
  infoRowColumn: { flexDirection: 'column', paddingHorizontal: Spacing.three, paddingVertical: Spacing.three },
  divider: { height: 1, backgroundColor: '#E0E1E6', marginHorizontal: Spacing.three },
  sectionLabel: { marginBottom: Spacing.two, textTransform: 'uppercase', letterSpacing: 0.8 },
  checkInBtn: { backgroundColor: '#38A169', borderRadius: Spacing.two, height: 48, justifyContent: 'center', alignItems: 'center', marginBottom: Spacing.two },
  checkOutBtn: { backgroundColor: '#DD6B20', borderRadius: Spacing.two, height: 48, justifyContent: 'center', alignItems: 'center', marginBottom: Spacing.three },
  btnText: { color: '#fff' },
});
