import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, translateApiError, useToast } from '@hotel-crm/mobile-shared';

import { openExport } from '@/lib/open-export';

/**
 * Runs an export and hands the file to the share sheet.
 *
 * The web opens a presigned URL in a new tab, which behaves poorly inside a
 * mobile webview — the file either downloads somewhere invisible or opens a
 * browser the user then has to escape. `Sharing.shareAsync` puts it in the
 * system sheet, where "send to WhatsApp" and "save to Files" are one tap.
 *
 * A NULL url is a real outcome, not an error: the report can generate with no
 * rows. Saying "no data" beats a share sheet containing nothing.
 */
export function ExportRow({
  label,
  run,
}: {
  label: string;
  run: () => Promise<{ url: string | null; filename: string; rowCount: number }>;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const onPress = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const report = await run();
      // A null url with zero rows is a real outcome, not a failure: the report
      // generated and had nothing in it. A share sheet containing an empty
      // file is worse than being told so.
      if (!report.url || report.rowCount === 0) {
        toast.show(t('settings.exportDataRows'), 'neutral');
        return;
      }
      const outcome = await openExport(report.url, report.filename);
      if (!outcome.ok) {
        // Named distinctly: a missing native module means the app needs
        // rebuilding, which is a different action from a failed transfer.
        toast.show(
          outcome.reason === 'NATIVE_MODULE_MISSING'
            ? t('settings.exportDataCannotOpen')
            : t('common.loadFailed'),
          'danger'
        );
      }
    } catch (e) {
      toast.show(translateApiError(e, t), 'danger');
    } finally {
      setBusy(false);
    }
  }, [busy, run, toast, t]);

  return <Button label={label} variant="ghost" loading={busy} onPress={() => void onPress()} />;
}
