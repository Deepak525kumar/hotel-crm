import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BottomSheet } from './bottom-sheet';
import { Button } from './index';
import { Input } from './input';
import { ThemedText } from '../themed-text';
import { Spacing } from '../../constants/theme';

/**
 * Confirmation for a write that another person feels.
 *
 * Cancelling an assignment, rejecting an application or deactivating an
 * employee all reach a real person's shift or pay, and several of those
 * endpoints require a reason string. `requireReason` makes the dialog refuse
 * to confirm without one rather than letting the API reject an empty body
 * after the fact -- a 400 surfacing as "something went wrong" teaches the
 * manager nothing about what the field wanted.
 *
 * Alert.alert is retained elsewhere for a plain yes/no; this exists for the
 * cases that need a typed reason, which Alert cannot collect on Android.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  requireReason,
  reasonLabel = 'Reason',
  busy,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  busy?: boolean;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const blocked = !!requireReason && reason.trim().length === 0;

  return (
    <BottomSheet
      visible={visible}
      onClose={onCancel}
      title={title}
      footer={
        <View style={styles.actions}>
          <Button label={cancelLabel} variant="ghost" onPress={onCancel} style={styles.action} />
          <Button
            label={confirmLabel}
            variant={destructive ? 'danger' : 'primary'}
            disabled={blocked}
            loading={busy}
            onPress={() => onConfirm(requireReason ? reason.trim() : undefined)}
            style={styles.action}
          />
        </View>
      }
    >
      {message ? <ThemedText themeColor="textSecondary">{message}</ThemedText> : null}
      {requireReason ? (
        <Input
          label={reasonLabel}
          value={reason}
          onChangeText={setReason}
          multiline
          // A reason is prose, so this is one of the few fields that wants the
          // platform's sentence-casing back (see Input's block comment).
          autoCapitalize="sentences"
          autoCorrect
        />
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
});
