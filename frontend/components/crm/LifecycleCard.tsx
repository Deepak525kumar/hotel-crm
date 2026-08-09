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
  label,
  isActive,
  deletedAt,
  onDeactivate,
  onReactivate,
  onDelete,
  onRestore,
}: {
  /** Lowercase noun for prose, e.g. "hotel" or "hotel group". */
  label: string;
  isActive: boolean;
  deletedAt: string | null;
  onDeactivate: () => Promise<unknown>;
  onReactivate: () => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  onRestore: () => Promise<unknown>;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const action = useAsyncAction();

  const run = (fn: () => Promise<unknown>, key: string) =>
    action.run(fn, {
      key,
      onSuccess: () => setConfirmDelete(false),
      errorMessage: `Could not update this ${label}. Please try again.`,
    });

  // Deleted is terminal until restored: showing deactivate/reactivate here
  // would invite the half-restored state this lifecycle exists to eliminate
  // (is_active flipped while deleted_at stays set).
  if (deletedAt) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Deleted {label}</p>
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
            Restore
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
              {isActive ? `Deactivate ${label}` : `Reactivate ${label}`}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {isActive
                ? `Temporarily pauses this ${label}. It stops appearing to workers and closes to new staffing, and can be reactivated at any time.`
                : `This ${label} is paused. Reactivating makes it available again immediately.`}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {isActive ? (
              <Button
                variant="outline"
                onClick={() => run(onDeactivate, "deactivate")}
                loading={action.isPending("deactivate")}
              >
                Deactivate
              </Button>
            ) : (
              <Button
                onClick={() => run(onReactivate, "reactivate")}
                loading={action.isPending("reactivate")}
              >
                Reactivate
              </Button>
            )}
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </div>
        </CardContent>
        <FormError className="px-6 pb-4">{action.error}</FormError>
      </Card>

      <Modal
        open={confirmDelete}
        onClose={() => !action.pending && setConfirmDelete(false)}
        title={`Delete ${label}`}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={action.pending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => run(onDelete, "delete")}
              loading={action.isPending("delete")}
            >
              Delete
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <p>
            This removes the {label} from operations entirely: it will no longer
            appear in lists, pickers or assignment flows.
          </p>
          {/* Stated explicitly so delete does not read as destructive, which
              is what makes it distinct from deactivate rather than a scarier
              synonym for it. */}
          <p>
            Nothing is erased. History is preserved and an admin can restore it
            from the archived view.
          </p>
          <FormError>{action.error}</FormError>
        </div>
      </Modal>
    </>
  );
}
