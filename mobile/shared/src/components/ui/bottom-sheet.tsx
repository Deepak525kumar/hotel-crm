import { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';
import { Radius, Spacing } from '../../constants/theme';
import { useTheme } from '../../hooks/use-theme';

/**
 * The one modal shape this app uses.
 *
 * A bottom sheet rather than a centred dialog because a manager is holding the
 * phone one-handed at a front desk: a sheet anchored to the bottom puts its
 * actions inside the thumb arc, while a centred dialog puts them mid-screen
 * where they need a grip shift.
 *
 * `presentationStyle` is left at the default and the backdrop is drawn here
 * rather than using `pageSheet`, so the same component renders identically on
 * Android, where `pageSheet` does nothing.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const theme = useTheme();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* The backdrop is a button on purpose: tapping outside is the gesture
          people try first, and a sheet that ignores it reads as frozen. */}
      <Pressable
        style={styles.backdrop}
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
      />
      <View style={[styles.sheet, { backgroundColor: theme.surfaceRaised }]}>
        <View style={[styles.grabber, { backgroundColor: theme.border }]} />
        {title ? (
          <ThemedText type="h2" style={styles.title}>
            {title}
          </ThemedText>
        ) : null}
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingBottom: Spacing.five,
    // Never taller than 88% of the screen, so the backdrop stays visibly
    // tappable -- a full-height sheet with a hidden backdrop is a screen, and
    // people then look for a back button that is not there.
    maxHeight: '88%',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: Radius.full,
    marginTop: Spacing.two,
    marginBottom: Spacing.two,
  },
  title: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.two },
  body: { flexGrow: 0 },
  bodyContent: { paddingHorizontal: Spacing.four, gap: Spacing.two },
  footer: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three },
});
