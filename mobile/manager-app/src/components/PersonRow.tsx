import { Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing, ThemedText, UserAvatar, useTheme } from '@hotel-crm/mobile-shared';

/**
 * A person, as a row.
 *
 * REBUILT 2026-09-23 from a screenshot the project owner sent. The previous
 * version stacked a role badge and a status badge down the right-hand side,
 * which spent roughly a third of a 375pt row on two chips and squeezed the
 * email into "test_regional@gmail...." — truncated mid-domain, where it
 * identifies nobody.
 *
 * Now: the role is a SECTION HEADER on the list, not a badge repeated on
 * every row, so the right side is free and the email gets the width. Status
 * is a coloured dot beside the name rather than a filled chip — "is this
 * person available" is a yes/no, and a 60pt green pill saying ACTIVE on every
 * row is chrome that carries one bit.
 *
 * An inactive person is dimmed rather than hidden: they are still on the
 * team, and hiding them makes a manager think the account was deleted.
 */
export function PersonRow({
  id,
  name,
  email,
  status,
  hasPhoto,
  onPress,
}: {
  id: string;
  name: string;
  email: string;
  status?: string | null;
  hasPhoto?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const inactive = status === 'DEACTIVATED' || status === 'DELETED' || status === 'REJECTED';
  const pending = status === 'PENDING' || status === 'IN_REVIEW' || status === 'REVIEW';

  const dot = inactive ? theme.danger : pending ? theme.warning : theme.success;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // The status is spoken, because the dot alone conveys nothing to a
      // screen reader.
      accessibilityLabel={`${name}${status ? `, ${status}` : ''}`}
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
        <View style={styles.nameRow}>
          <View style={[styles.dot, { backgroundColor: dot }]} />
          <ThemedText type="smallBold" style={styles.name} numberOfLines={1}>
            {name}
          </ThemedText>
        </View>
        {/* head, not tail: an email truncated at the end keeps the local part,
            which is what identifies the person. Cutting the domain loses
            nothing; cutting the name loses everything. */}
        <ThemedText
          type="small"
          themeColor="textSecondary"
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {email}
        </ThemedText>
      </View>

      <ThemedText themeColor="textSecondary">›</ThemedText>
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
  text: { flex: 1, flexShrink: 1, minWidth: 0, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  name: { flexShrink: 1, minWidth: 0 },
  dot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
});
