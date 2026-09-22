import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '../themed-text';
import { Elevation, Radius, Spacing } from '../../constants/theme';
import { useTheme } from '../../hooks/use-theme';

export type ToastTone = 'success' | 'danger' | 'neutral';
type Toast = { id: number; message: string; tone: ToastTone };

const ToastContext = createContext<{ show: (message: string, tone?: ToastTone) => void } | null>(null);

/**
 * Non-blocking confirmation.
 *
 * The shipped apps use `Alert.alert` for everything, which is a modal: it
 * stops the screen and needs a tap to dismiss. That is right for "cancel this
 * shift?" and wrong for "saved", and a manager doing twelve small writes in a
 * row would tap twelve alerts away.
 *
 * Alert is deliberately kept for destructive confirmation (see ConfirmDialog);
 * this is for the outcome, not the decision.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, tone: ToastTone = 'neutral') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 3500);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ toasts }: { toasts: readonly Toast[] }) {
  const theme = useTheme();
  if (toasts.length === 0) return null;

  const backgrounds: Record<ToastTone, string> = {
    success: theme.successSubtle,
    danger: theme.dangerSubtle,
    neutral: theme.backgroundSelected,
  };

  return (
    // pointerEvents none: a toast must never swallow a tap meant for the
    // screen underneath it -- it is feedback, not a control.
    <View style={styles.viewport} pointerEvents="none">
      {toasts.map((toast) => (
        <View
          key={toast.id}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[styles.toast, { backgroundColor: backgrounds[toast.tone] }, Elevation.md]}
        >
          <ThemedText type="small">{toast.message}</ThemedText>
        </View>
      ))}
    </View>
  );
}

/**
 * Throws when used outside the provider rather than silently no-opping: a
 * confirmation that never appears is indistinguishable from a write that
 * never happened, and that is the wrong thing to discover in production.
 */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider');
  return context;
}

const styles = StyleSheet.create({
  viewport: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
    // Above the tab bar, not over it.
    bottom: Spacing.six,
    gap: Spacing.two,
  },
  toast: {
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
});
