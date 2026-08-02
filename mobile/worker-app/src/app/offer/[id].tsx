import { StyleSheet, ScrollView, Pressable, ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState, useCallback } from 'react';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { api, ApiError } from '@/lib/api';
import { resolveMySlots } from '@/lib/broadcast-eligibility';
import { Spacing } from '@/constants/theme';
import { useAuthStore } from '@/stores/auth-store';
import type { Broadcast, BroadcastEligibility, SkillTag } from '@/types/api';

const SKILL_LABELS: Record<string, string> = {
  CLEANER: 'Cleaner',
  PUBLIC_SERVICE: 'Public service',
  KITCHEN_DISHWASHER: 'Kitchen dishwasher',
  WAITER: 'Waiter',
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
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [offer, setOffer] = useState<Broadcast | null>(null);
  const [eligibility, setEligibility] = useState<BroadcastEligibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState<SkillTag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fulfilledSkill, setFulfilledSkill] = useState<SkillTag | null>(null);

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

  const onAccept = async (skill: SkillTag) => {
    if (!id) return;
    setError(null);
    setAccepting(skill);
    try {
      const result = await api.workRequests.acceptBroadcast(id, skill);
      if (result.status === 'accepted') {
        router.replace(`/shift/${result.assignment_id}`);
        return;
      }
      // Lost the first-accept race — not an error, no assignment created.
      // Show a non-error state and let the worker re-check the offer.
      setFulfilledSkill(skill);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setAccepting(null);
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
        <ThemedText type="small" themeColor="textSecondary">Offer not found.</ThemedText>
      </ThemedView>
    );
  }

  const mySlots = resolveMySlots(offer, eligibility, currentUserId);
  const closed = offer.status !== 'OPEN';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <ThemedText type="small" themeColor="textSecondary">← Back</ThemedText>
        </Pressable>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <ThemedText type="subtitle" style={styles.title}>Shift offer</ThemedText>
          {offer.hotel && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.hotelName}>
              {offer.hotel.name}
            </ThemedText>
          )}

          <ThemedView type="backgroundElement" style={styles.section}>
            <InfoRow
              label="Date"
              value={new Date(offer.shift_date).toLocaleDateString('en-US', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
              })}
            />
            <View style={styles.divider} />
            <InfoRow label="Time" value={`${offer.shift_start_time} – ${offer.shift_end_time}`} />
            {offer.hourly_rate ? (
              <>
                <View style={styles.divider} />
                <InfoRow label="Pay" value={`$${offer.hourly_rate}/hr`} />
              </>
            ) : null}
          </ThemedView>

          {offer.description ? (
            <>
              <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
                Description
              </ThemedText>
              <ThemedView type="backgroundElement" style={styles.descCard}>
                <ThemedText type="small">{offer.description}</ThemedText>
              </ThemedView>
            </>
          ) : null}

          <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
            Skills needed
          </ThemedText>
          {offer.skill_slots.map((slot) => {
            const filled = slot.confirmed_count >= slot.headcount;
            const canAccept = !closed && mySlots.some((s) => s.skill === slot.skill);
            return (
              <ThemedView key={slot.id} type="backgroundElement" style={styles.slotRow}>
                <View style={styles.flex}>
                  <ThemedText type="smallBold">{SKILL_LABELS[slot.skill] ?? slot.skill}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {slot.confirmed_count}/{slot.headcount} confirmed
                  </ThemedText>
                </View>
                {canAccept && (
                  <Pressable
                    onPress={() => onAccept(slot.skill)}
                    disabled={accepting !== null}
                    style={styles.acceptButton}
                  >
                    {accepting === slot.skill ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <ThemedText type="smallBold" style={styles.acceptButtonText}>Accept</ThemedText>
                    )}
                  </Pressable>
                )}
                {filled && <ThemedText type="small" themeColor="textSecondary">Filled</ThemedText>}
              </ThemedView>
            );
          })}

          {fulfilledSkill && (
            <ThemedView type="backgroundElement" style={styles.noticeCard}>
              <ThemedText type="small" themeColor="textSecondary">
                This shift was already filled by another worker.
              </ThemedText>
            </ThemedView>
          )}

          {closed && (
            <ThemedView type="backgroundElement" style={styles.noticeCard}>
              <ThemedText type="small" themeColor="textSecondary">
                This offer is no longer open.
              </ThemedText>
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
