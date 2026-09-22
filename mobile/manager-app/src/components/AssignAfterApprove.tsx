import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import {
  BottomSheet,
  Button,
  SelectSheet,
  Spacing,
  ThemedText,
  api,
} from '@hotel-crm/mobile-shared';
import { StyleSheet, View } from 'react-native';

/**
 * The SECOND half of approving a Manager or Regional Manager.
 *
 * `ADR-065` makes their approval two steps: approve, then assign to a group
 * (and, for a Manager, a primary hotel). One without the other leaves the
 * record APPROVED and the hotel with no manager — a state that reads as
 * success from every response and is broken in the database. Scenario 02's
 * defect table records the mirror image of it.
 *
 * This sheet exists so the second call cannot be forgotten: the approve flow
 * opens it and does not report success until it completes.
 */
export function AssignAfterApprove({
  visible,
  employeeId,
  needsHotel,
  busy,
  onCancel,
  onAssign,
}: {
  visible: boolean;
  employeeId: string | null;
  /** A Manager is assigned a primary hotel; a Regional Manager is not. */
  needsHotel: boolean;
  busy: boolean;
  onCancel: () => void;
  onAssign: (input: { hotel_group_id: string; primary_hotel_id?: string }) => void;
}) {
  const { t } = useTranslation();
  const [groupId, setGroupId] = useState<string | null>(null);
  const [hotelId, setHotelId] = useState<string | null>(null);

  const groups = useSWR(visible ? 'crm/hotel-groups' : null, () => api.crm.hotelGroups());
  const hotels = useSWR(visible && needsHotel ? 'crm/hotels' : null, () => api.crm.hotels());

  // The group is always required; the hotel only for a Manager. Enforced here
  // so the request is never sent in a shape the server will reject.
  const ready = groupId !== null && (!needsHotel || hotelId !== null);

  return (
    <BottomSheet
      visible={visible}
      onClose={onCancel}
      title={t('onboarding.assignApprovedEmployee')}
      footer={
        <View style={styles.actions}>
          <Button label={t('common.cancel')} variant="ghost" onPress={onCancel} style={styles.action} />
          <Button
            label={t('onboarding.completeAssignmentAction')}
            disabled={!ready}
            loading={busy}
            style={styles.action}
            onPress={() =>
              groupId &&
              onAssign({
                hotel_group_id: groupId,
                ...(needsHotel && hotelId ? { primary_hotel_id: hotelId } : {}),
              })
            }
          />
        </View>
      }
    >
      <ThemedText type="small" themeColor="textSecondary">
        {t('onboarding.assignApprovedEmployee')}
      </ThemedText>

      <SelectSheet
        label={t('nav.hotelGroups')}
        value={groupId}
        options={(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
        onChange={setGroupId}
      />

      {needsHotel ? (
        <SelectSheet
          label={t('nav.hotels')}
          value={hotelId}
          options={(hotels.data ?? [])
            // Only hotels in the chosen group: assigning a manager to a hotel
            // outside it is refused server-side, and offering it invites the
            // error rather than preventing it.
            .filter((h) => !groupId || h.hotel_group_id === groupId)
            .map((h) => ({ value: h.id, label: h.name, hint: h.city }))}
          onChange={setHotelId}
        />
      ) : null}

      {employeeId ? null : <ThemedText type="small">{t('common.loadFailed')}</ThemedText>}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
});
