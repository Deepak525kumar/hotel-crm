import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RatingTier } from '@/types/api';

/**
 * TREQ-003 / TRULE-003: the tier label shown next to a worker's 0-100 score.
 *
 * Colours follow the boundaries the system already acts on (70 = PASSED and
 * the first warning, 50 = the severe warning, 40 = FAILED), so the badge can
 * never look reassuring to someone who is being sent rework. Thresholds live
 * server-side in backend/src/modules/quality/rating-tiers.ts and are derived
 * there, not re-implemented per client.
 *
 * Renders nothing for null: an unrated worker is a new starter, and a badge
 * in a standings column invites being read as a standing.
 */
const TIER_COLORS: Record<RatingTier, { bg: string; fg: string }> = {
  ELITE: { bg: '#D1FAE5', fg: '#065F46' },
  HIGH: { bg: '#DCFCE7', fg: '#166534' },
  STANDARD: { bg: '#F3F4F6', fg: '#374151' },
  LOW: { bg: '#FEF3C7', fg: '#92400E' },
  PROBATION: { bg: '#FEE2E2', fg: '#991B1B' },
};

export function RatingTierBadge({ tier }: { tier: RatingTier | null }) {
  const { t } = useTranslation();
  if (!tier) return null;

  const c = TIER_COLORS[tier];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.text, { color: c.fg }]}>{t(`ratingTier.${tier}`)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  text: { fontSize: 11, fontWeight: '600' },
});
