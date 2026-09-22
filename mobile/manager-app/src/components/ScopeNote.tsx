import { useTranslation } from 'react-i18next';

import { Badge, type ScopeShape } from '@hotel-crm/mobile-shared';

/**
 * Says what the numbers on screen actually cover.
 *
 * Three people can open the same screen and see three different datasets: a
 * hotel manager sees one hotel, a regional manager their whole group, an
 * admin the platform. Without a label the figures are ambiguous in a way that
 * matters -- "12 open requests" means something very different at each scope,
 * and an RM comparing notes with a hotel manager would reasonably conclude
 * one of the two screens is broken.
 *
 * Deliberately a Badge and not a picker. Narrowing to one hotel needs a
 * hotels list this client does not have yet; it arrives with the hotels
 * screens. Until then this states the scope rather than implying a choice
 * that is not offered.
 */
export function ScopeNote({ scope }: { scope: ScopeShape }) {
  const { t } = useTranslation();

  if (scope.kind === 'global') return <Badge label={t('analytics.platformOverview')} tone="primary" />;
  if (scope.kind === 'group') return <Badge label={t('nav.hotelGroups')} tone="primary" />;
  if (scope.kind === 'hotel') return <Badge label={t('nav.hotels')} tone="primary" />;

  // A null scope denies every scoped capability server-side (ADR-030 D-7), so
  // the screen will be empty no matter what. Saying so beats an empty card.
  return <Badge label={t('analytics.noPermission')} tone="warning" />;
}
