import { StyleSheet, ScrollView, Pressable, ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState, useCallback } from 'react';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { api } from '@/lib/api';
import { resolveMySlots } from '@/lib/broadcast-eligibility';
import { Spacing } from '@/constants/theme';
import type { Broadcast, BroadcastEligibility, SkillTag } from '@/types/api';
import { useTranslation } from 'react-i18next';
import { BackLink } from '@/components/BackLink';
import { translateApiError } from '../../lib/api-error-i18n';

// Keys, resolved at render. The same four labels already live in the web
// app's lib/skills.ts under these exact keys -- the drift that module was
// written to stop had reached the mobile apps too.
const SKILL_LABEL_KEY: Record<string, string> = {
  CLEANER: 'skills.CLEANER',
  PUBLIC_SERVICE: 'skills.PUBLIC_SERVICE',
  KITCHEN_DISHWASHER: 'skills.KITCHEN_DISHWASHER',
  WAITER: 'skills.WAITER',
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <ThemedView style={styles.infoRow} type="backgroundElement">
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText type="small">{value}</ThemedText>
    </ThemedView>
  );
}

export default function OfferDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [offer, setOffer] = useState<Broadcast | null>(null);
  const [eligibility, setEligibility] = useState<BroadcastEligibility | null>(null);
  const [loading, setLoading] = useState(true);
  // Keyed by slot id, not skill: a `null` skill (no specific skill
  // required, 2026-08-26) would otherwise be indistinguishable from "not
  // accepting anything" -- slot ids are always unique and non-null.
  const [acceptingSlotId, setAcceptingSlotId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fulfilledSlotId, setFulfilledSlotId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [offerRes, eligibilityRes] = await Promise.all([
        api.workRequests.get(id) as Promise<Broadcast>,
        api.workRequests.getBroadcastEligibility(id),
      ]);
      setOffer(offerRes);
      setEligibility(eligibilityRes);
    } catch {
      setOffer(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const onAccept = async (skill: SkillTag | null, slotId: string) => {
    if (!id) return;
    setError(null);
    setAcceptingSlotId(slotId);
    try {
      const result = await api.workRequests.acceptBroadcast(id, skill);
      if (result.status === 'accepted') {
        router.replace(`/shift/${result.assignment_id}`);
        return;
      }
      // Lost the first-accept race — not an error, no assignment created.
      // Show a non-error state and let the worker re-check the offer.
      setFulfilledSlotId(slotId);
      await load();
    } catch (err) {
      setError(translateApiError(err, t, 'errors.generic'));
    } finally {
      setAcceptingSlotId(null);
    }
  };

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!offer || !offer.skill_slots || offer.skill_slots.length === 0) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText type="small" themeColor="textSecondary">{t('shifts.offerNotFound')}</ThemedText>
      </ThemedView>
    );
  }

  const mySlots = resolveMySlots(offer, eligibility);
  const closed = offer.status !== 'OPEN';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <BackLink />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <ThemedText type="subtitle" style={styles.title}>{t('shifts.offer')}</ThemedText>
          {offer.hotel && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.hotelName}>
              {offer.hotel.name}
            </ThemedText>
          )}

          <ThemedView type="backgroundElement" style={styles.section}>
            <InfoRow
              label={t('fields.date')}
              value={new Date(offer.shift_date).toLocaleDateString('en-US', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
              })}
            />
            <View style={styles.divider} />
            <InfoRow label={t('fields.time')} value={`${offer.shift_start_time} – ${offer.shift_end_time}`} />
            {offer.hourly_rate ? (
              <>
                <View style={styles.divider} />
                <InfoRow label={t('fields.pay')} value={`$${offer.hourly_rate}/hr`} />
              </>
            ) : null}
          </ThemedView>

          {offer.description ? (
            <>
              <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>{t("fields.description")}</ThemedText>
              <ThemedView type="backgroundElement" style={styles.descCard}>
                <ThemedText type="small">{offer.description}</ThemedText>
              </ThemedView>
            </>
          ) : null}

          <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>{t("requests.skillsNeeded")}</ThemedText>
          {offer.skill_slots.map((slot) => {
            const filled = slot.confirmed_count >= slot.headcount;
            // Compared by id, not skill: mySlots is already the eligible
            // subset of offer.skill_slots (resolveMySlots), and multiple
            // slots can share the same skill value -- including `null`
            // ("no specific skill required", 2026-08-26) -- so an id
            // comparison is the only one that can't cross-match the wrong
            // slot.
            const canAccept = !closed && mySlots.some((s) => s.id === slot.id);
            return (
              <ThemedView key={slot.id} type="backgroundElement" style={styles.slotRow}>
                <View style={styles.flex}>
                  <ThemedText type="smallBold">
                    {slot.skill === null ? t('requests.anySkill') : SKILL_LABEL_KEY[slot.skill] ? t(SKILL_LABEL_KEY[slot.skill]) : slot.skill}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {slot.confirmed_count}/{slot.headcount} confirmed
                  </ThemedText>
                </View>
                {canAccept && (
                  <Pressable
                    onPress={() => onAccept(slot.skill, slot.id)}
                    disabled={acceptingSlotId !== null}
                    style={styles.acceptButton}
                  >
                    {acceptingSlotId === slot.id ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <ThemedText type="smallBold" style={styles.acceptButtonText}>{t('jobs.accept')}</ThemedText>
                    )}
                  </Pressable>
                )}
                {filled && <ThemedText type="small" themeColor="textSecondary">{t('jobs.filled')}</ThemedText>}
              </ThemedView>
            );
          })}

          {fulfilledSlotId && (
            <ThemedView type="backgroundElement" style={styles.noticeCard}>
              <ThemedText type="small" themeColor="textSecondary">{t("shifts.alreadyFilledByAnother")}</ThemedText>
            </ThemedView>
          )}

          {closed && (
            <ThemedView type="backgroundElement" style={styles.noticeCard}>
              <ThemedText type="small" themeColor="textSecondary">{t("shifts.offerNoLongerOpen")}</ThemedText>
            </ThemedView>
          )}

          {error && (
            <ThemedView type="backgroundElement" style={styles.errorCard}>
              <ThemedText type="small">{error}</ThemedText>
            </ThemedView>
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
  title: { marginBottom: Spacing.one },
  hotelName: { marginBottom: Spacing.three },
  section: { borderRadius: Spacing.two, overflow: 'hidden', marginBottom: Spacing.three },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.three, paddingVertical: Spacing.three },
  divider: { height: 1, backgroundColor: '#E0E1E6', marginHorizontal: Spacing.three },
  sectionLabel: { marginBottom: Spacing.two, textTransform: 'uppercase', letterSpacing: 0.8 },
  descCard: { borderRadius: Spacing.two, padding: Spacing.three, marginBottom: Spacing.three },
  slotRow: { flexDirection: 'row', alignItems: 'center', borderRadius: Spacing.two, padding: Spacing.three, marginBottom: Spacing.two, gap: Spacing.two },
  flex: { flex: 1 },
  acceptButton: { backgroundColor: '#3182CE', borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, minWidth: 72, alignItems: 'center' },
  acceptButtonText: { color: '#ffffff' },
  noticeCard: { borderRadius: Spacing.two, padding: Spacing.three, alignItems: 'center', marginBottom: Spacing.two },
  errorCard: { borderRadius: Spacing.two, padding: Spacing.three, marginTop: Spacing.two },
});
