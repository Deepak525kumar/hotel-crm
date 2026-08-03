"use client";

import { useState } from "react";
import { mutate } from "swr";
import { useHotelBlocklist } from "@/hooks/useBlocklist";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { employeesApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { BlocklistWriteGate } from "@/components/auth/RoleGate";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  FormError,
  Input,
  Modal,
  Skeleton,
} from "@/components/ui";
import type { EmployeeBlocklistEntry } from "@/lib/types";

function BlocklistRow({ entry }: { entry: EmployeeBlocklistEntry }) {
  return (
    <li className="flex items-center justify-between gap-4 border-b border-gray-100 py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-gray-900">{entry.reason}</p>
        <p className="text-xs text-gray-500">Added {formatDate(entry.created_at)}</p>
      </div>
    </li>
  );
}

/**
 * SPEC-EMP-001 (REQ-EMP-005/RULE-EMP-07): a hotel's employee blocklist.
 * `employee_id` is employee-management's own human-facing identifier, not a
 * `User.id`. `employeesApi.getByUserId` can resolve one from the other when
 * the caller already has a `User.id` in hand (e.g. from the worker's own
 * profile page), but this form has no such context to start from — it takes
 * `employee_id` as free text (same posture as HR's `template_id`).
 * Rendering this is safe for any role — the backend (`checkHotelAccess()`,
 * `employees:read`) is the authoritative enforcement point — but the add
 * action is wrapped in `BlocklistWriteGate` so a read-only viewer doesn't
 * see a button that will only ever 403.
 */
export function BlocklistCard({ hotelId }: { hotelId: string }) {
  const { data: entries, isLoading, error } = useHotelBlocklist(hotelId);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <>
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Employee blocklist</CardTitle>
          <BlocklistWriteGate>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              Add to blocklist
            </Button>
          </BlocklistWriteGate>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="py-6 text-center text-sm text-red-600">
              Failed to load the blocklist.
            </p>
          ) : isLoading ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          ) : !entries || entries.length === 0 ? (
            <EmptyState
              title="No blocked employees"
              description="Employees blocked from assignment at this hotel appear here."
            />
          ) : (
            <ul>
              {entries.map((entry) => (
                <BlocklistRow key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AddBlocklistEntryModal hotelId={hotelId} open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}

function AddBlocklistEntryModal({
  hotelId,
  open,
  onClose,
}: {
  hotelId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const create = useAsyncAction();

  const reset = () => {
    setEmployeeId("");
    setReason("");
    setFieldError(null);
  };

  const handleClose = () => {
    if (create.pending) return;
    reset();
    onClose();
  };

  const onSubmit = () => {
    setFieldError(null);
    if (!employeeId.trim() || !reason.trim()) {
      setFieldError("Employee ID and reason are both required.");
      return;
    }

    create.run(
      () =>
        employeesApi.setBlocklist(hotelId, {
          employee_id: employeeId.trim(),
          reason: reason.trim(),
        }),
      {
        onSuccess: async () => {
          await mutate(["blocklist", hotelId]);
          reset();
          onClose();
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Add to blocklist"
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={create.pending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={create.pending}>
            Add
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Employee ID"
          hint="The Employee Management employee ID (EmploymentRecord.employee_id) — not this person's account/user ID."
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
        />
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <FormError>{fieldError ?? create.error}</FormError>
      </div>
    </Modal>
  );
}
