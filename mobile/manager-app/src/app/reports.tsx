import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import {
  Card,
  MaxContentWidth,
  ScreenHeader,
  SectionHeader,
  SelectSheet,
  Spacing,
  ThemedText,
  ThemedView,
  api,
} from '@hotel-crm/mobile-shared';

import { BackLink } from '@/components/BackLink';
import { ExportRow } from '@/components/ExportRow';

/**
 * Team reports — S-37, the one surface with no web counterpart.
 *
 * `reports:read-team` / `reports:export-team` are held by manager, regional
 * manager and admin, and nothing in the web portal spends them. This screen is
 * the only way to reach three of the four datasets.
 *
 * EXPORT ONLY, no on-screen table (owner decision, 2026-09-22): a phone is a
 * poor place to read a report and a good place to send one. The file goes
 * straight to the share sheet, where "mail it to the owner" is one tap.
 *
 * WHY PRESET RANGES AND NOT A DATE PICKER. The server requires `from` and `to`
 * together, refuses `from > to`, and caps the span at 366 days. A picker can
 * express all three mistakes; a preset cannot express any of them, so the
 * whole class of "why was this rejected" disappears. It also avoids adding
 * `@react-native-community/datetimepicker` — a NATIVE module, and this app's
 * most expensive recurring bug is a native import that is absent from the
 * running binary (see `mobile/CLAUDE.md` rule 4). `DateField` exists in the
 * design system for the day a screen genuinely needs an arbitrary date; this
 * one does not.
 */

const DATASETS = ['attendance', 'assignments', 'absences', 'rooms'] as const;
type Dataset = (typeof DATASETS)[number];

/** Label per dataset, reusing keys that already name these things elsewhere. */
const DATASET_LABEL: Record<Dataset, string> = {
  attendance: 'nav.attendance',
  assignments: 'nav.assignments',
  absences: 'calendar.absences',
  rooms: 'nav.rooms',
};

const FORMATS = ['xlsx', 'pdf'] as const;
type Format = (typeof FORMATS)[number];

const RANGES = [
  { key: '7', days: 7 },
  { key: '30', days: 30 },
  { key: '90', days: 90 },
  { key: '365', days: 365 },
] as const;

/**
 * `YYYY-MM-DD`, `n` days before today, in the DEVICE's zone.
 *
 * Built from local getters rather than `toISOString().slice(0, 10)`: the
 * latter is UTC, so between midnight and 02:00 Berlin it names YESTERDAY, and
 * a report would quietly start and end a day early. The same trap
 * `CALENDAR_TIMEZONE` exists for.
 */
function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function Reports() {
  const { t } = useTranslation();
  const [dataset, setDataset] = useState<Dataset>('attendance');
  const [format, setFormat] = useState<Format>('xlsx');
  const [rangeKey, setRangeKey] = useState<string>('30');

  const range = useMemo(() => {
    const days = RANGES.find((r) => r.key === rangeKey)?.days ?? 30;
    return { from: dayOffset(days), to: dayOffset(0) };
  }, [rangeKey]);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content}>
          <BackLink />
          <ScreenHeader title={t('nav.reports')} subtitle={t('reports.pageDescription')} />

          <Card>
            <SelectSheet
              label={t('fields.type')}
              value={dataset}
              options={DATASETS.map((d) => ({ value: d, label: t(DATASET_LABEL[d]) }))}
              onChange={(next) => setDataset(next as Dataset)}
            />

            <SelectSheet
              label={t('fields.date')}
              value={rangeKey}
              // One interpolated key rather than four hand-written strings.
              // `common.lastNDays` was ADDED for this screen (2026-09-23) --
              // it did not already exist, whatever an earlier draft of this
              // comment claimed.
              options={RANGES.map((r) => ({
                value: r.key,
                label: t('common.lastNDays', { count: r.days }),
              }))}
              onChange={setRangeKey}
            />

            <SelectSheet
              label={t('fields.format')}
              value={format}
              // Deliberately not localised: these are file-format names, not
              // words. "XLSX" is XLSX in every locale.
              options={FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }))}
              onChange={(next) => setFormat(next as Format)}
            />

            <ThemedText type="small" themeColor="textSecondary">
              {range.from} – {range.to}
            </ThemedText>
          </Card>

          <ExportRow
            label={t('settings.exportDataAction')}
            run={() =>
              api.reports.exportTeam({
                dataset,
                format,
                from: range.from,
                to: range.to,
              })
            }
          />

          <SectionHeader title={t('settings.exportData')} />
          <ThemedText type="small" themeColor="textSecondary">
            {t('settings.exportDataDescription')}
          </ThemedText>
          <ExportRow label={t('settings.exportDataShort')} run={() => api.reports.exportMine()} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
