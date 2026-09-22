import { Pressable, StyleSheet, View } from 'react-native';

import {
  Badge,
  Radius,
  Spacing,
  ThemedText,
  UserAvatar,
  useTheme,
  type BadgeTone,
} from '@hotel-crm/mobile-shared';

/**
 * A person, as a row.
 *
 * The web shows users as a four-column table: name, email, role, status. That
 * does not survive 375pt, and the first version of this screen collapsed it
 * to a bare title/subtitle row that read as a list of email addresses.
 *
 * So: avatar for recognition (people scan faces faster than names), name and
 * email stacked, and role and status as separate badges — they answer
 * different questions ("what do they do" vs "can they work"), and merging
 * them into one chip loses the second.
 *
 * An inactive person is dimmed rather than hidden. They are still on the
 * team, and hiding them makes a manager think the account was deleted.
 */
export function PersonRow({
  id,
  name,
  email,
  role,
  status,
  hasPhoto,
  onPress,
}: {
  id: string;
  name: string;
  email: string;
  role: string;
  status?: string | null;
  hasPhoto?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const inactive = status === 'DEACTIVATED' || status === 'DELETED' || status === 'REJECTED';

  const statusTone: BadgeTone =
    status === 'ACTIVE' ? 'success' : inactive ? 'danger' : status ? 'warning' : 'neutral';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${role}${status ? `, ${status}` : ''}`}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.border,
          opacity: pressed ? 0.85 : inactive ? 0.55 : 1,
        },
      ]}
    >
      <UserAvatar userId={id} name={name} hasPhoto={hasPhoto} size={40} />

      <View style={styles.text}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {email}
        </ThemedText>
      </View>

      <View style={styles.badges}>
        <Badge label={role} tone="neutral" />
        {status ? <Badge label={status} tone={statusTone} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.three,
    minHeight: 48,
  },
  text: { flex: 1, flexShrink: 1, minWidth: 0, gap: 1 },
  badges: { alignItems: 'flex-end', gap: Spacing.one, flexShrink: 0 },
});
