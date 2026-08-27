import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RatingTier } from '@/types/api';
import { useTheme } from '@/hooks/use-theme';

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
/**
 * Paired theme tokens rather than ten hex literals. The previous palette was
 * light-mode only: every `bg` was a pale wash that turned the label
 * unreadable against a dark card, and none of it tracked the accent.
 */
const TIER_TONE: Record<RatingTier, 'success' | 'neutral' | 'warning' | 'danger'> = {
  ELITE: 'success',
  HIGH: 'success',
  STANDARD: 'neutral',
  LOW: 'warning',
  PROBATION: 'danger',
};

export function RatingTierBadge({ tier }: { tier: RatingTier | null }) {
  const { t } = useTranslation();
  // Both hooks before the early return: hooks must run in the same order on
  // every render, and `tier` is nullable.
  const theme = useTheme();
  if (!tier) return null;

  const tone = TIER_TONE[tier];
  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: tone === 'neutral' ? theme.backgroundSelected : theme[`${tone}Subtle`],
        },
      ]}
    >
      <Text
        style={[styles.text, { color: tone === 'neutral' ? theme.textSecondary : theme[tone] }]}
      >
        {t(`ratingTier.${tier}`)}
      </Text>
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
