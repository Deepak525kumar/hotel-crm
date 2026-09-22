import { StyleSheet, View } from 'react-native';

import { BottomSheet } from './bottom-sheet';
import { Button } from './index';
import { ThemedText } from '../themed-text';
import { Spacing } from '../../constants/theme';
import { useTheme } from '../../hooks/use-theme';

export type ProgressItemState = 'pending' | 'running' | 'done' | 'failed';
export type ProgressItem = { key: string; label: string; state: ProgressItemState; detail?: string };

/**
 * Per-item progress for a multi-write operation.
 *
 * Recurring calendar placement fires one POST per occurrence, up to 26. On a
 * hotel's connection that is a long-running sequence in which some
 * occurrences can succeed and others hit a conflict -- a worker already
 * placed that day, an absence in the way.
 *
 * Reporting that as a single "Saved" toast would be a lie: the manager would
 * believe 26 shifts exist when 19 do, and discover the gap when nobody turns
 * up. So each occurrence gets a row and a real outcome, the run is cancellable
 * mid-flight, and a partial result is reported as partial.
 */
export function ProgressSheet({
  visible,
  title,
  items,
  onCancel,
  onClose,
}: {
  visible: boolean;
  title: string;
  items: readonly ProgressItem[];
  /** Absent once the run has finished -- there is nothing left to cancel. */
  onCancel?: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const done = items.filter((i) => i.state === 'done').length;
  const failed = items.filter((i) => i.state === 'failed').length;
  const settled = items.every((i) => i.state === 'done' || i.state === 'failed');

  const tone: Record<ProgressItemState, string> = {
    pending: theme.textSecondary,
    running: theme.primary,
    done: theme.success,
    failed: theme.danger,
  };

  return (
    <BottomSheet
      visible={visible}
      // While the run is in flight the backdrop must not dismiss it: a
      // half-finished sequence hidden behind a closed sheet is the exact
      // ambiguity this component exists to remove.
      onClose={settled ? onClose : () => {}}
      title={title}
      footer={
        settled ? (
          <Button label="Done" onPress={onClose} />
        ) : onCancel ? (
          <Button label="Stop" variant="danger" onPress={onCancel} />
        ) : undefined
      }
    >
      <ThemedText type="small" themeColor="textSecondary">
        {done} of {items.length} saved{failed > 0 ? ` · ${failed} failed` : ''}
      </ThemedText>

      {items.map((item) => (
        <View key={item.key} style={styles.row}>
          <View style={[styles.dot, { backgroundColor: tone[item.state] }]} />
          <View style={styles.text}>
            <ThemedText type="small" numberOfLines={1}>
              {item.label}
            </ThemedText>
            {item.detail ? (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                {item.detail}
              </ThemedText>
            ) : null}
          </View>
        </View>
      ))}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, paddingVertical: Spacing.one },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, flexShrink: 0 },
  text: { flex: 1, flexShrink: 1, minWidth: 0 },
});
