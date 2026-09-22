import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Badge, Radius, Spacing, ThemedText, useTheme } from '@hotel-crm/mobile-shared';

/**
 * A placement row that can be long-pressed and dragged onto another day.
 *
 * LONG PRESS, NOT PLAIN DRAG. `activateAfterLongPress(400)` means a normal
 * vertical swipe scrolls the agenda instead of picking a shift up -- a pan
 * that activates immediately competes with the scroll view and makes the
 * list feel broken. It also means a move takes deliberate intent: this write
 * changes when a real person is expected at work.
 *
 * ACCESSIBILITY. A drag is entirely inoperable with a screen reader -- there
 * is no gesture for "pick up and move to the 24th" in VoiceOver or
 * TalkBack. `accessibilityActions` exposes the SAME write through the rotor,
 * so the feature exists for everyone. This is an equivalent path, not a
 * replacement for the gesture.
 *
 * The row never moves itself. It reports the release position upward and
 * springs home; the screen decides whether that position was a real day and
 * owns the optimistic update. A row that animated into place before the
 * server agreed would show a shift on a day it was never written to.
 */
export function PlacementRow({
  title,
  subtitle,
  status,
  onDragStart,
  onDragMove,
  onDragEnd,
  onRequestMove,
}: {
  title: string;
  subtitle?: string;
  status?: string;
  onDragStart: () => void;
  /** Absolute x of the finger, so the screen can resolve a day cell. */
  onDragMove: (absoluteX: number) => void;
  onDragEnd: (absoluteX: number) => void;
  /** The accessible equivalent: opens a day picker for the same move. */
  onRequestMove: () => void;
}) {
  const theme = useTheme();
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const lifted = useSharedValue(0);

  const haptic = useCallback(() => {
    // Required LAZILY, and fire-and-forget.
    //
    // expo-haptics was added to this app on 2026-09-22, so any development
    // build cut before that does not contain its native half. A top-level
    // import would throw during module evaluation and take down the whole
    // Rota screen — the same failure that `assistant.tsx` hit via
    // expo-speech-recognition, reported as "I am not able to log into the
    // app". A drag without a buzz is a far better outcome than no screen.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Haptics = require('expo-haptics') as {
        impactAsync: (style: unknown) => Promise<void>;
        ImpactFeedbackStyle: { Medium: unknown };
      };
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch {
      // No haptics in this build, or no taptic engine. Neither is a failure.
    }
  }, []);

  const pan = Gesture.Pan()
    .activateAfterLongPress(400)
    .onStart(() => {
      lifted.value = withSpring(1);
      runOnJS(haptic)();
      runOnJS(onDragStart)();
    })
    .onUpdate((e) => {
      offsetX.value = e.translationX;
      offsetY.value = e.translationY;
      runOnJS(onDragMove)(e.absoluteX);
    })
    .onEnd((e) => {
      runOnJS(onDragEnd)(e.absoluteX);
    })
    .onFinalize(() => {
      // Springs home on EVERY outcome, including a cancelled gesture and a
      // rejected move. The screen owns where the row actually belongs.
      offsetX.value = withSpring(0);
      offsetY.value = withSpring(0);
      lifted.value = withSpring(0);
    });

  const animated = useAnimatedStyle(() => ({
    transform: [
      { translateX: offsetX.value },
      { translateY: offsetY.value },
      { scale: 1 + lifted.value * 0.03 },
    ],
    opacity: 1 - lifted.value * 0.15,
    zIndex: lifted.value > 0 ? 10 : 0,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          styles.row,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          animated,
        ]}
        accessibilityRole="button"
        accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
        accessibilityHint="Double tap and hold to drag to another day, or use the Move action"
        accessibilityActions={[{ name: 'move', label: 'Move to another day' }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'move') onRequestMove();
        }}
      >
        <View style={styles.body}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {title}
          </ThemedText>
          {subtitle ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {subtitle}
            </ThemedText>
          ) : null}
        </View>
        {status ? <Badge label={status} tone={status === 'CANCELLED' ? 'danger' : 'neutral'} /> : null}
      </Animated.View>
    </GestureDetector>
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
  body: { flex: 1, flexShrink: 1, minWidth: 0, gap: 2 },
});
