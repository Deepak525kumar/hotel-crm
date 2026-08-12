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
import { useAuthStore } from "@/stores/auth";
import { creatableRolesFor } from "@/lib/roleHierarchy";
import type { Role, UserDetail } from "@/lib/types";

const ROLE_LABEL: Record<Role, string> = {
  worker: "Worker",
  checker: "Checker",
  manager: "Manager",
  regional_manager: "Regional Manager",
  admin: "Admin",
};

/**
 * Every role, for EDIT mode — which changes an existing user's role via the
 * Admin-only `PUT /users/:id/role` endpoint and is governed by that route, not
 * by RULE A (a role CHANGE is not a role CREATION). CREATE mode narrows this
 * to `creatableRolesFor(viewer)` instead; see the `options` computation below.
 */
const ALL_ROLE_OPTIONS: { value: Role; label: string }[] = (
  ["worker", "checker", "manager", "regional_manager", "admin"] as const
).map((value) => ({ value, label: ROLE_LABEL[value] }));

export interface UserFormValues {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone: string;
  role: Role;
  is_active: boolean;
}

/** Submitted shape: unlike form state, blank phone becomes `null`, not `""`. */
export type UserFormSubmitValues = Omit<UserFormValues, "phone"> & {
  phone: string | null;
};

function toValues(user: UserDetail | null | undefined, defaultRole: Role): UserFormValues {
  return {
    email: user?.email ?? "",
    password: "",
    first_name: user?.first_name ?? "",
    last_name: user?.last_name ?? "",
    phone: user?.phone ?? "",
    // RULE A: in create mode the default must be a role the viewer may
    // actually create, not a hardcoded "worker" — an admin defaulting to
    // "worker" would pre-fill a value the backend rejects.
    role: user?.role ?? defaultRole,
    is_active: user?.is_active ?? true,
  };
}

export interface UserFormProps {
  mode: "create" | "edit";
  user?: UserDetail | null;
  /** PUT /users/:id/role is admin-only backend-side; disable the selector for any other actor so a manager/RM can't submit a role change that will just be rejected. */
  canEditRole?: boolean;
  submitting?: boolean;
  error?: string | null;
  onSubmit: (values: UserFormSubmitValues) => void;
  onCancel?: () => void;
}

/** Presentational create/edit form for user accounts. */
export function UserForm({
  mode,
  user,
  canEditRole = true,
  submitting = false,
  error,
  onSubmit,
  onCancel,
}: UserFormProps) {
  // RULE A (project-owner decision, 2026-08-12): a create form may only offer
  // the roles the CURRENT viewer may create — one level below itself. See
  // lib/roleHierarchy.ts. UI affordance only; the backend enforces the same
  // table at the route and service layer.
  const viewerRole = useAuthStore((s) => s.user?.role);
  const allowedCreateRoles = creatableRolesFor(viewerRole);

  const roleOptions =
    mode === "create"
      ? allowedCreateRoles.map((value) => ({ value, label: ROLE_LABEL[value] }))
      : ALL_ROLE_OPTIONS;

  // A viewer with exactly one creatable role (admin, regional_manager) gets a
  // single fixed option; worker/checker get none, in which case the form is not
  // reachable at all (the page's own gate) — but default defensively rather
  // than fall back to a role they cannot create.
  const defaultCreateRole: Role = allowedCreateRoles[0] ?? "worker";

  const [form, setForm] = useState<UserFormValues>(() => toValues(user, defaultCreateRole));

  const set = <K extends keyof UserFormValues>(key: K, value: UserFormValues[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...form,
      email: form.email.trim(),
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      // Blank phone must not be sent as "" — phone is unique-but-nullable,
      // and "" collides with every other user who also left it blank.
      phone: form.phone.trim() || null,
    });
  };

  const valid =
    form.first_name.trim() &&
    form.last_name.trim() &&
    (mode === "edit" ||
      (form.email.trim() &&
        form.password.length >= 8 &&
        form.phone.trim() &&
        // RULE A: never let a create submit carry a role the viewer may not
        // create, even if form state somehow held a stale value.
        allowedCreateRoles.includes(form.role)));

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
              label={mode === "create" ? "Phone" : "Phone (optional)"}
              type="tel"
              required={mode === "create"}
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
            <Select
              label="Role"
              value={form.role}
              onChange={(e) => set("role", e.target.value as Role)}
              options={roleOptions}
              // In create mode a single-option selector is fixed, not editable:
              // there is nothing to choose between, and leaving it enabled
              // implies otherwise.
              disabled={!canEditRole || (mode === "create" && roleOptions.length <= 1)}
              hint={
                !canEditRole
                  ? "Only admins can change a user's role."
                  : mode === "create" && roleOptions.length === 1
                    ? `You may only create ${ROLE_LABEL[roleOptions[0]!.value]} accounts.`
                    : undefined
              }
            />
          </div>

          {mode === "edit" && (
            <Checkbox
              label="Active (can sign in and be assigned work)"
              checked={form.is_active}
              onChange={(e) => set("is_active", e.target.checked)}
            />
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
              {mode === "create" ? "Create user" : "Save changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
