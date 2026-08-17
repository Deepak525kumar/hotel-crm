"use client";

import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  FormError,
  Modal,
} from "@/components/ui";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { formatDateTime } from "@/lib/format";
import { useTranslation } from "react-i18next";

/**
 * Entity lifecycle controls, shared by Hotels and Hotel Groups (2026-08-07).
 *
 * The two states are distinct in kind, not degree:
 *
 *   DEACTIVATED — a temporary, reversible operational pause. The entity still
 *                 exists and we intend to use it again. It stays visible in
 *                 admin views and reports; only operational availability stops.
 *
 *   DELETED     — permanent removal from operations, history preserved. It
 *                 disappears from every operational list, picker and
 *                 assignment flow, and returns only through an explicit admin
 *                 restore from the archived view.
 *
 * Rendering them as one card with mutually exclusive states is deliberate: the
 * previous UI showed a lone "Deactivate" button that vanished once pressed,
 * leaving no way back. Making the whole lifecycle visible in one place is what
 * stops the states blurring into "two buttons that do the same thing".
 *
 * Delete is never destructive here. A true hard delete, if it is ever needed,
 * belongs in a separate purge operation with stronger authentication.
 */
export function LifecycleCard({
  entity,
  isActive,
  deletedAt,
  onDeactivate,
  onReactivate,
  onDelete,
  onRestore,
}: {
  /**
   * Which entity this card governs, used as an i18n key prefix
   * (`lifecycle.<entity>.*`).
   *
   * Was previously a lowercase English noun interpolated into sentence
   * templates -- `Deactivate ${label}`, `This ${label} is paused.` That
   * cannot be translated correctly: German needs a different article per
   * gender ("Dieses Hotel" vs "Diese Hotelgruppe"), and Arabic, Ukrainian and
   * Urdu inflect the noun by grammatical case. Each locale therefore writes
   * whole sentences per entity instead of receiving a noun to slot in.
   *
   * Adding an entity means adding its `lifecycle.<entity>.*` block to every
   * catalogue; the locale parity test fails loudly if one is missed.
   */
  entity: "hotel" | "hotelGroup";
  isActive: boolean;
  deletedAt: string | null;
  onDeactivate: () => Promise<unknown>;
  onReactivate: () => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  onRestore: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const action = useAsyncAction();

  const run = (fn: () => Promise<unknown>, key: string) =>
    action.run(fn, {
      key,
      onSuccess: () => setConfirmDelete(false),
      errorMessage: t(`lifecycle.${entity}.updateFailed`),
    });

  // Deleted is terminal until restored: showing deactivate/reactivate here
  // would invite the half-restored state this lifecycle exists to eliminate
  // (is_active flipped while deleted_at stays set).
  if (deletedAt) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {t(`lifecycle.${entity}.deleted`)}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Removed from operations on {formatDateTime(deletedAt)}. History is
              preserved and it can be restored.
            </p>
          </div>
          <Button
            onClick={() => run(onRestore, "restore")}
            loading={action.isPending("restore")}
            className="shrink-0"
          >
            {t("hotels.restoreAction")}
          </Button>
        </CardContent>
        <FormError className="px-6 pb-4">{action.error}</FormError>
      </Card>
    );
  }

  return (
    <>
      <Card className={isActive ? "border-red-100 dark:border-red-900/60" : undefined}>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {isActive
                ? t(`lifecycle.${entity}.deactivate`)
                : t(`lifecycle.${entity}.reactivate`)}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {isActive
                ? t(`lifecycle.${entity}.pauseHint`)
                : t(`lifecycle.${entity}.pausedHint`)}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {isActive ? (
              <Button
                variant="outline"
                onClick={() => run(onDeactivate, "deactivate")}
                loading={action.isPending("deactivate")}
              >
                {t("employees.deactivateAction")}
              </Button>
            ) : (
              <Button
                onClick={() => run(onReactivate, "reactivate")}
                loading={action.isPending("reactivate")}
              >
                {t("employees.reactivateAction")}
              </Button>
            )}
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              {t("employees.deleteAction")}
            </Button>
          </div>
        </CardContent>
        <FormError className="px-6 pb-4">{action.error}</FormError>
      </Card>

      <Modal
        open={confirmDelete}
        onClose={() => !action.pending && setConfirmDelete(false)}
        title={t(`lifecycle.${entity}.deleteTitle`)}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={action.pending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => run(onDelete, "delete")}
              loading={action.isPending("delete")}
            >
              {t("employees.deleteAction")}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <p>{t(`lifecycle.${entity}.deleteHint`)}</p>
          {/* Stated explicitly so delete does not read as destructive, which
              is what makes it distinct from deactivate rather than a scarier
              synonym for it. */}
          <p>{t("lifecycle.nothingErased")}</p>
          <FormError>{action.error}</FormError>
        </div>
      </Modal>
    </>
  );
}
