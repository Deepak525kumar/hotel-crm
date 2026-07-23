"use client";

import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  Input,
  Select,
} from "@/components/ui";
import type { Role, UserDetail } from "@/lib/types";

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "worker", label: "Worker" },
  { value: "checker", label: "Checker" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
];

export interface UserFormValues {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone: string;
  role: Role;
  is_active: boolean;
}

function toValues(user?: UserDetail | null): UserFormValues {
  return {
    email: user?.email ?? "",
    password: "",
    first_name: user?.first_name ?? "",
    last_name: user?.last_name ?? "",
    phone: user?.phone ?? "",
    role: user?.role ?? "worker",
    is_active: user?.is_active ?? true,
  };
}

export interface UserFormProps {
  mode: "create" | "edit";
  user?: UserDetail | null;
  submitting?: boolean;
  error?: string | null;
  onSubmit: (values: UserFormValues) => void;
  onCancel?: () => void;
}

/** Presentational create/edit form for user accounts. */
export function UserForm({
  mode,
  user,
  submitting = false,
  error,
  onSubmit,
  onCancel,
}: UserFormProps) {
  const [form, setForm] = useState<UserFormValues>(() => toValues(user));

  const set = <K extends keyof UserFormValues>(key: K, value: UserFormValues[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...form,
      email: form.email.trim(),
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      phone: form.phone.trim(),
    });
  };

  const valid =
    form.first_name.trim() &&
    form.last_name.trim() &&
    (mode === "edit" ||
      (form.email.trim() && form.password.length >= 8));

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "create" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Email"
                type="email"
                required
                autoComplete="off"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
              />
              <Input
                label="Temporary password"
                type="password"
                required
                autoComplete="new-password"
                minLength={8}
                hint="At least 8 characters."
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
              />
            </div>
          ) : (
            <Input label="Email" value={form.email} disabled readOnly />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="First name"
              required
              value={form.first_name}
              onChange={(e) => set("first_name", e.target.value)}
            />
            <Input
              label="Last name"
              required
              value={form.last_name}
              onChange={(e) => set("last_name", e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Phone (optional)"
              type="tel"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
            <Select
              label="Role"
              value={form.role}
              onChange={(e) => set("role", e.target.value as Role)}
              options={ROLE_OPTIONS}
            />
          </div>

          {mode === "edit" && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => set("is_active", e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Active (can sign in and be assigned work)
            </label>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

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
              {mode === "create" ? "Create user" : "Save changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
