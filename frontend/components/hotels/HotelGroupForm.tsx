"use client";

import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  FormError,
  Input,
  Textarea,
} from "@/components/ui";
import type { HotelGroup } from "@/lib/types";
import { useTranslation } from "react-i18next";

export interface HotelGroupFormValues {
  name: string;
  billing_info: string;
}

function toValues(group?: HotelGroup | null): HotelGroupFormValues {
  return {
    name: group?.name ?? "",
    billing_info: group?.billing_info ?? "",
  };
}

export interface HotelGroupFormProps {
  mode: "create" | "edit";
  group?: HotelGroup | null;
  submitting?: boolean;
  error?: string | null;
  onSubmit: (values: HotelGroupFormValues) => void;
  onCancel?: () => void;
}

/**
 * Presentational hotel-group form for create and edit.
 *
 * Person-centric assignment redesign (2026-08-07): this form no longer
 * assigns a Regional Manager. Assignment is now made from the person's own
 * page (`/users/:id`), which writes `HotelGroup.regional_manager_user_id`
 * via the single authoritative role+assignment endpoint
 * (`PUT /users/:id/role`). A group is created vacant and assigned an RM
 * afterwards. The group detail page displays who currently holds the role.
 */
export function HotelGroupForm({
  mode,
  group,
  submitting = false,
  error,
  onSubmit,
  onCancel,
}: HotelGroupFormProps) {
  const { t } = useTranslation();
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

  const valid = Boolean(form.name.trim());

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t("fields.groupName")}
            required
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Northern Region"
          />

          <Textarea
            label={t("fields.billingInfoOptional")}
            rows={3}
            value={form.billing_info}
            onChange={(e) => set("billing_info", e.target.value)}
            placeholder={t("hotelGroups.billingPlaceholder")}
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
                {t("common.cancel")}
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
