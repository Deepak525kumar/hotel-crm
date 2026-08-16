"use client";

import { SKILL_OPTIONS } from "@/lib/skills";
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
import type { EmploymentType, Role, UserDetail, Hotel, HotelGroup } from "@/lib/types";
import { useTranslation } from "react-i18next";

// ADR-065 (Universal Onboarding Gate): mandatory for every non-admin role at
// creation — mirrors the backend CreateUserSchema.superRefine requirement.

const EMPLOYMENT_TYPE_OPTIONS: { value: EmploymentType; label: string }[] = [
  { value: "FULL_TIME", label: "Full-time" },
  { value: "PART_TIME", label: "Part-time" },
];

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
  // ADR-065 (Universal Onboarding Gate): required for every non-admin role
  // at creation — the backend auto-creates the linked EmploymentRecord from
  // these, so there is no separate "Start onboarding" step for anyone.
  job_title: string;
  start_date: string;
  employment_type: EmploymentType | "";
  skills: string[];
  work_permit_required: boolean;
  hotel_id?: string;
  hotel_group_id?: string;
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
    job_title: "",
    start_date: "",
    employment_type: "",
    skills: [],
    work_permit_required: false,
    hotel_id: user?.managed_hotels?.[0]?.id ?? "",
    hotel_group_id: user?.managed_hotel_groups?.[0]?.id ?? "",
  };
}

export interface UserFormProps {
  mode: "create" | "edit";
  user?: UserDetail | null;
  /** PUT /users/:id/role is admin-only backend-side; disable the selector for any other actor so a manager/RM can't submit a role change that will just be rejected. */
  canEditRole?: boolean;
  hotels?: Hotel[];
  hotelGroups?: HotelGroup[];
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
  hotels = [],
  hotelGroups = [],
  submitting = false,
  error,
  onSubmit,
  onCancel,
}: UserFormProps) {
  const { t } = useTranslation();
  // RULE A (project-owner decision, 2026-08-12): a create form may only offer
  // the roles the CURRENT viewer may create — one level below itself. See
  // lib/roleHierarchy.ts. UI affordance only; the backend enforces the same
  // table at the route and service layer.
  const viewerRole = useAuthStore((s) => s.user?.role);
  const allowedCreateRoles = creatableRolesFor(viewerRole);

  const roleOptions =
    mode === "create"
      ? allowedCreateRoles.map((value) => ({ value, label: ROLE_LABEL[value] }))
      : viewerRole === "regional_manager"
        ? ALL_ROLE_OPTIONS.filter((o) => ["worker", "checker", "manager"].includes(o.value))
        : ALL_ROLE_OPTIONS;

  // A viewer with exactly one creatable role (admin, regional_manager) gets a
  // single fixed option; worker/checker get none, in which case the form is not
  // reachable at all (the page's own gate) — but default defensively rather
  // than fall back to a role they cannot create.
  const defaultCreateRole: Role = allowedCreateRoles[0] ?? "worker";

  const [form, setForm] = useState<UserFormValues>(() => toValues(user, defaultCreateRole));

  const set = <K extends keyof UserFormValues>(key: K, value: UserFormValues[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // ADR-065: admin accounts have no onboarding/EmploymentRecord concept.
  // RULE A means `admin` is never actually in `allowedCreateRoles`, but this
  // stays role-derived (not hardcoded to "always show") so it degrades
  // correctly if that ever changes.
  const requiresOnboardingFields = mode === "create" && form.role !== "admin";

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
      job_title: form.job_title.trim(),
      ...(form.role === "worker" ? { skills: form.skills } : {}),
      ...(form.role === "manager" ? { hotel_id: form.hotel_id } : {}),
      ...(form.role === "regional_manager" ? { hotel_group_id: form.hotel_group_id } : {}),
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
        allowedCreateRoles.includes(form.role) &&
        // ADR-065: required for every non-admin role at creation.
        (!requiresOnboardingFields ||
          (form.job_title.trim() && form.start_date && form.employment_type))));

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "create" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={t("fields.email")}
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
            <Input label={t("fields.email")} value={form.email} disabled readOnly />
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
              label={t("fields.role")}
              value={form.role}
              onChange={(e) => set("role", e.target.value as Role)}
              options={roleOptions}
              // In create mode a single-option selector is fixed, not editable:
              // there is nothing to choose between, and leaving it enabled
              // implies otherwise.
              disabled={!canEditRole || (mode === "create" && roleOptions.length <= 1)}
              hint={
                !canEditRole
                  ? "Only admins and regional managers can change a user's role."
                  : mode === "create" && roleOptions.length === 1
                    ? `You may only create ${ROLE_LABEL[roleOptions[0]!.value]} accounts.`
                    : undefined
              }
            />
          </div>

          {form.role === "manager" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Assigned Hotel"
                value={form.hotel_id ?? ""}
                onChange={(e) => set("hotel_id", e.target.value)}
                options={[
                  { value: "", label: "Unassigned (leave vacant)" },
                  ...hotels.map((h) => ({ value: h.id, label: h.name })),
                ]}
                disabled={!canEditRole}
              />
            </div>
          )}

          {form.role === "regional_manager" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Assigned Hotel Group"
                value={form.hotel_group_id ?? ""}
                onChange={(e) => set("hotel_group_id", e.target.value)}
                options={[
                  { value: "", label: "Unassigned (leave vacant)" },
                  ...hotelGroups.map((g) => ({ value: g.id, label: g.name })),
                ]}
                disabled={!canEditRole}
              />
            </div>
          )}

          {requiresOnboardingFields && (
            <div className="space-y-4 rounded-md border border-gray-200 p-4 dark:border-gray-800">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Onboarding
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                An employment record is created automatically — {form.first_name.trim() || "this person"} will
                see &ldquo;My Onboarding&rdquo; and manage their own documents and contract from their first login.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label={t("fields.jobTitle")}
                  required
                  value={form.job_title}
                  onChange={(e) => set("job_title", e.target.value)}
                />
                <Input
                  label="Start date"
                  type="date"
                  required
                  value={form.start_date}
                  onChange={(e) => set("start_date", e.target.value)}
                />
              </div>
              <Checkbox
                label="Requires a work permit (non-EU/EEA/Swiss)"
                checked={form.work_permit_required}
                onChange={(e) => set("work_permit_required", e.target.checked)}
              />
              
              {form.role === "worker" && (
                <div className="space-y-2 sm:col-span-2 pt-2">
                  <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t("fields.skills")}</span>
                  <div className="grid grid-cols-2 gap-2">
                    {SKILL_OPTIONS.map((opt) => (
                      <Checkbox
                        key={opt.value}
                        label={t(opt.labelKey)}
                        checked={form.skills.includes(opt.value)}
                        onChange={(e) => {
                          const newSkills = e.target.checked
                            ? [...form.skills, opt.value]
                            : form.skills.filter((s) => s !== opt.value);
                          set("skills", newSkills);
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              <Select
                label={t("fields.employmentType")}
                value={form.employment_type}
                onChange={(e) => set("employment_type", e.target.value as EmploymentType)}
                options={[
                  { value: "", label: "Select…" },
                  ...EMPLOYMENT_TYPE_OPTIONS,
                ]}
              />
            </div>
          )}

          {mode === "edit" && (
            // 2026-08-13 fix (reported live: a brand-new, still-Pending
            // account's Edit screen showed this checked with a label
            // claiming it means "can be... assigned work"). This checkbox
            // controls ONLY `User.is_active` (account sign-in access), which
            // the backend sets true from the moment the account is created —
            // it does not touch, and was never wired to, EmploymentStatus.
            // Work-assignment eligibility is decided entirely by the
            // onboarding lifecycle (PENDING -> ACTIVE via approval), shown
            // immediately above this in the page's own Employment section —
            // a second, unrelated meaning bolted onto this label just
            // asserted that state without reflecting it, which read as "the
            // system thinks this unapproved worker can already be assigned
            // work."
            <Checkbox
              label="Active (can sign in to the platform)"
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
