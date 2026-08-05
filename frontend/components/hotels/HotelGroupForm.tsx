"use client";

import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  FormError,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import type { HotelGroup, UserSummary } from "@/lib/types";

export interface HotelGroupFormValues {
  name: string;
  regional_manager_user_id: string;
  billing_info: string;
}

function toValues(group?: HotelGroup | null): HotelGroupFormValues {
  return {
    name: group?.name ?? "",
    regional_manager_user_id: group?.regional_manager_user_id ?? "",
    billing_info: group?.billing_info ?? "",
  };
}

export interface HotelGroupFormProps {
  mode: "create" | "edit";
  group?: HotelGroup | null;
  /** Candidate regional managers (managers/admins). */
  managers: UserSummary[];
  managersLoading?: boolean;
  submitting?: boolean;
  error?: string | null;
  onSubmit: (values: HotelGroupFormValues) => void;
  onCancel?: () => void;
}

/** Presentational hotel-group form for create and edit. */
export function HotelGroupForm({
  mode,
  group,
  managers,
  managersLoading = false,
  submitting = false,
  error,
  onSubmit,
  onCancel,
}: HotelGroupFormProps) {
  const [form, setForm] = useState<HotelGroupFormValues>(() => toValues(group));

  const set = <K extends keyof HotelGroupFormValues>(
    key: K,
    value: HotelGroupFormValues[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...form,
      name: form.name.trim(),
      billing_info: form.billing_info.trim(),
    });
  };

  // Vacancy model (2026-08-06): create still requires an RM (ADR-023's
  // original "one HotelGroup has exactly one assigned RM" invariant at
  // creation time); edit allows leaving it unassigned (vacant), since a
  // group can now go through a demotion/transfer gap.
  const valid = form.name.trim() && (mode === "edit" || form.regional_manager_user_id);

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Group name"
            required
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Northern Region"
          />

          <Select
            label="Regional manager"
            required={mode === "create"}
            value={form.regional_manager_user_id}
            onChange={(e) => set("regional_manager_user_id", e.target.value)}
            placeholder={mode === "create" ? (managersLoading ? "Loading managers…" : "Select a manager") : undefined}
          >
            {mode === "edit" && <option value="">Vacant (unassigned)</option>}
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.first_name} {m.last_name} — {m.email}
              </option>
            ))}
          </Select>

          <Textarea
            label="Billing info (optional)"
            rows={3}
            value={form.billing_info}
            onChange={(e) => set("billing_info", e.target.value)}
            placeholder="Invoicing address, VAT id, cost center…"
          />

          <FormError>{error}</FormError>

          <div className="flex justify-end gap-3 pt-2">
            {onCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={submitting}
              >
                Cancel
              </Button>
            )}
            <Button type="submit" loading={submitting} disabled={submitting || !valid}>
              {mode === "create" ? "Create group" : "Save changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
