"use client";

import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  FormError,
  Input,
  Select,
} from "@/components/ui";
import type { Hotel, HotelGroup } from "@/lib/types";

/** Common timezones offered by the selector; free-form values still validate. */
const TIMEZONES = [
  "Europe/Berlin",
  "Europe/London",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Zurich",
  "Europe/Vienna",
  "Europe/Amsterdam",
  "UTC",
];

export interface HotelFormValues {
  name: string;
  city: string;
  country: string;
  address: string;
  timezone: string;
  is_active: boolean;
  accepting_jobs: boolean;
  hotel_group_id: string;
  /** GD-14/OD-GEO-001/004: hotel-coordinate source of truth for
   * backend-geo's distance-check. Empty string = not yet set (matches
   * hotel_group_id's own "" = unassigned convention). */
  latitude: string;
  longitude: string;
}

function toValues(hotel?: Hotel | null): HotelFormValues {
  return {
    name: hotel?.name ?? "",
    city: hotel?.city ?? "",
    country: hotel?.country ?? "Germany",
    address: hotel?.address ?? "",
    timezone: hotel?.timezone ?? "Europe/Berlin",
    is_active: hotel?.is_active ?? true,
    accepting_jobs: hotel?.accepting_jobs ?? true,
    hotel_group_id: hotel?.hotel_group_id ?? "",
    latitude: hotel?.latitude != null ? String(hotel.latitude) : "",
    longitude: hotel?.longitude != null ? String(hotel.longitude) : "",
  };
}

export interface HotelFormProps {
  mode: "create" | "edit";
  hotel?: Hotel | null;
  /** Groups for the assignment selector (edit mode only). */
  groups?: HotelGroup[];
  submitting?: boolean;
  error?: string | null;
  onSubmit: (values: HotelFormValues) => void;
  onCancel?: () => void;
}

/**
 * Presentational hotel form for both create and edit. The parent owns the
 * network call (via `onSubmit`) and surfaces `submitting`/`error`, keeping the
 * form free of data-access logic.
 */
export function HotelForm({
  mode,
  hotel,
  groups = [],
  submitting = false,
  error,
  onSubmit,
  onCancel,
}: HotelFormProps) {
  const [form, setForm] = useState<HotelFormValues>(() => toValues(hotel));

  const set = <K extends keyof HotelFormValues>(
    key: K,
    value: HotelFormValues[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ ...form, name: form.name.trim(), city: form.city.trim(), address: form.address.trim() });
  };

  const valid = form.name.trim() && form.city.trim() && form.address.trim();

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Name"
            required
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Grand Central Hotel"
          />

          <Input
            label="Address"
            required
            value={form.address}
            onChange={(e) => set("address", e.target.value)}
            placeholder="Street and number"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="City"
              required
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
            />
            <Input
              label="Country"
              required
              value={form.country}
              onChange={(e) => set("country", e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Timezone"
              value={form.timezone}
              onChange={(e) => set("timezone", e.target.value)}
              options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
            />
            {mode === "edit" && (
              <Select
                label="Hotel group"
                value={form.hotel_group_id}
                onChange={(e) => set("hotel_group_id", e.target.value)}
              >
                <option value="">Unassigned</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            )}
          </div>

          {mode === "edit" && (
            <>
              <Checkbox
                label="Active (visible to workers and open for staffing)"
                checked={form.is_active}
                onChange={(e) => set("is_active", e.target.checked)}
              />
              <Checkbox
                label="Accepting new work requests"
                checked={form.accepting_jobs}
                onChange={(e) => set("accepting_jobs", e.target.checked)}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Latitude"
                  type="number"
                  step="any"
                  min={-90}
                  max={90}
                  value={form.latitude}
                  onChange={(e) => set("latitude", e.target.value)}
                  placeholder="e.g. 52.5200"
                  hint="Required for worker geofence check-in (GD-14)"
                />
                <Input
                  label="Longitude"
                  type="number"
                  step="any"
                  min={-180}
                  max={180}
                  value={form.longitude}
                  onChange={(e) => set("longitude", e.target.value)}
                  placeholder="e.g. 13.4050"
                />
              </div>
            </>
          )}

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
              {mode === "create" ? "Create hotel" : "Save changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
