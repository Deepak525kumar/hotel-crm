import { StyleSheet, ActivityIndicator } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import type { ContractDto } from '@/types/api';

export function ContractStatusCard({
  contract,
  loading,
}: {
  contract: ContractDto | null;
  loading: boolean;
}) {
  const theme = useTheme();

  if (loading) {
    return (
      <ThemedView type="backgroundElement" style={styles.card}>
        <ActivityIndicator color={theme.text} style={styles.loader} />
      </ThemedView>
    );
  }

  if (!contract) {
    return (
      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText type="smallBold" style={styles.emptyTitle}>
          No Active Contract
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyDescription}>
          You do not have a contract in the system yet.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedView style={styles.row}>
        <ThemedText type="small" themeColor="textSecondary">Status</ThemedText>
        <ThemedText type="smallBold" style={{ textTransform: 'capitalize' }}>
          {contract.status.toLowerCase()}
        </ThemedText>
      </ThemedView>
      <ThemedView style={styles.divider} type="backgroundSelected" />
      
      <ThemedView style={styles.row}>
        <ThemedText type="small" themeColor="textSecondary">Position</ThemedText>
        <ThemedText type="smallBold">{contract.position}</ThemedText>
      </ThemedView>
      <ThemedView style={styles.divider} type="backgroundSelected" />

      <ThemedView style={styles.row}>
        <ThemedText type="small" themeColor="textSecondary">Start Date</ThemedText>
        <ThemedText type="small">{contract.start_date}</ThemedText>
      </ThemedView>
      
      {contract.end_date && (
        <>
          <ThemedView style={styles.divider} type="backgroundSelected" />
          <ThemedView style={styles.row}>
            <ThemedText type="small" themeColor="textSecondary">End Date</ThemedText>
            <ThemedText type="small">{contract.end_date}</ThemedText>
          </ThemedView>
        </>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
    marginBottom: Spacing.four,
  },
  loader: {
    padding: Spacing.six,
  },
  emptyTitle: {
    textAlign: 'center',
    paddingTop: Spacing.four,
  },
  emptyDescription: {
    textAlign: 'center',
    paddingBottom: Spacing.four,
    paddingTop: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  divider: {
    height: 1,
    marginHorizontal: Spacing.three,
  },
});
