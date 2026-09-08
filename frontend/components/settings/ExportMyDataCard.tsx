"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, AlertTriangle, Check } from "lucide-react";
import { reportsApi } from "@/lib/api";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";

/**
 * "Export my data" — the Article 15/20 right of access and portability, as a
 * button.
 *
 * SHOWN TO EVERY ROLE, deliberately. Workers and checkers are the people most
 * likely to want their own record and least likely to be given it any other
 * way, and the underlying token (`reports:export-own`) is held by every role
 * for exactly that reason. This card must never grow a role check.
 *
 * WHY THE LINK ISN'T A `download` ATTRIBUTE. The server builds the workbook,
 * stores it, and hands back a SHORT-LIVED presigned URL. The browser is given
 * that URL rather than a blob, so a year of somebody's history is never held
 * in page memory and the download survives a slow connection. It opens in a
 * new tab because a presigned S3 URL is cross-origin — `download` is ignored
 * there, and a link that silently does nothing is worse than one that
 * navigates.
 *
 * A NULL URL IS A REAL STATE, not a failure to hide. With storage
 * unconfigured the server returns the report metadata and no link; saying so
 * plainly is better than a button that appears to work and leads nowhere.
 */
export function ExportMyDataCard() {
  const { t } = useTranslation();
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "working" }
    | { kind: "ready"; url: string; filename: string; rows: number }
    | { kind: "unavailable" }
    | { kind: "failed"; message: string }
  >({ kind: "idle" });

  const run = async () => {
    setState({ kind: "working" });
    try {
      const report = await reportsApi.exportMine();
      if (!report.url) {
        setState({ kind: "unavailable" });
        return;
      }
      setState({
        kind: "ready",
        url: report.url,
        filename: report.filename,
        rows: report.rowCount,
      });
      // Opened immediately so the common case is one click, not two. The
      // link stays on screen afterwards because a popup blocker may have
      // swallowed this, and because the link expires — a person who missed
      // it needs something to click, not a button to press again.
      window.open(report.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setState({
        kind: "failed",
        message: error instanceof Error ? error.message : t("common.unknownError", "Something went wrong."),
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.exportData", "Your data")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 py-2">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t(
            "settings.exportDataDescription",
            "Download everything the platform holds about you as an Excel file: your shifts, attendance, absences, rooms you logged, and your messages with the assistant. It covers the last 12 months."
          )}
        </p>

        <Button onClick={run} disabled={state.kind === "working"}>
          <Download className="mr-2 h-4 w-4" aria-hidden="true" />
          {state.kind === "working"
            ? t("settings.exportDataWorking", "Preparing your file…")
            : t("settings.exportDataAction", "Export my data")}
        </Button>

        {/* aria-live so the outcome is announced: the visual cue is a link
            appearing below a button, which a screen reader would otherwise
            not report. */}
        <div aria-live="polite">
          {state.kind === "ready" && (
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200">
              <Check className="h-4 w-4 text-green-600 dark:text-green-400" aria-hidden="true" />
              {t("settings.exportDataReady", "Your file is ready")} ({state.rows}{" "}
              {t("settings.exportDataRows", "rows")}).{" "}
              <a
                href={state.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-blue-600 underline hover:text-blue-700 dark:text-blue-400"
              >
                {state.filename}
              </a>
              <span className="text-gray-500 dark:text-gray-400">
                {t("settings.exportDataExpires", "The link expires shortly.")}
              </span>
            </p>
          )}

          {state.kind === "unavailable" && (
            <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {t(
                "settings.exportDataNoStorage",
                "Your file was prepared, but file storage is not set up on this server, so there is no download link. Please tell an administrator."
              )}
            </p>
          )}

          {state.kind === "failed" && (
            <p className="flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {state.message}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
