"use client";

import { SKILL_OPTIONS } from "@/lib/skills";
import { useRef, useState } from "react";
import { UserRound, UploadCloud } from "lucide-react";
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
import type { Role, SkillTag, UserDetail, Hotel, HotelGroup } from "@/lib/types";
import { useTranslation } from "react-i18next";

// The onboarding fields (job title, start date, employment type) were taken
// off this form in #615 and are defaulted server-side, so the options list
// and the ADR-065 note that described them are gone with them -- they had
// been left behind as dead code.

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
  // Typed to the enum, not string[]: these values go straight to the API,
  // whose CreateUserInput takes SkillTag[] -- so a wrong value is a compile
  // error here rather than a 422 from the server's enum check.
  skills: SkillTag[];
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
    skills: [],
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
  /**
   * `photo` is non-null only in create mode (mandatory there — see the
   * `valid` check below); edit mode has no photo-change UI yet, so it always
   * passes `null`.
   */
  onSubmit: (values: UserFormSubmitValues, photo: File | null) => void;
  onCancel?: () => void;
}

const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

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

  // A manager's target GROUP is derived from their hotel, and the server
  // REFUSES an admin-created manager with no group ("Admin must explicitly
  // provide a target_hotel_group_id"). Hotel.hotel_group_id is nullable, so a
  // group-less hotel would have satisfied this form and then failed the
  // submit with a message about a field the form never showed. Offering only
  // grouped hotels for that one case keeps the derivation total.
  //
  // Every other role keeps the full list: their hotel is an optional routing
  // hint, not the source of a required value.
  const selectableHotels =
    mode === "create" && form.role === "manager"
      ? hotels.filter((h) => !!h.hotel_group_id)
      : hotels;

  // Mandatory at creation (RULE-PHOTO-01): every account created through this
  // form must carry a real photo, uploaded straight to the backend's S3
  // storage — never a URL field (see auth/service.ts#updateProfile on the
  // backend for why that was removed rather than reused). Edit mode has no
  // photo-change affordance yet, so this state is unused there.
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
      setPhotoError("Photo must be a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_PHOTO_SIZE_BYTES) {
      setPhotoError("Photo must be smaller than 5 MB.");
      return;
    }

    setPhotoError(null);
    setPhoto(file);
    setPhotoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  };

  // Onboarding section removed per request

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(
      {
        ...form,
        email: form.email.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        // Blank phone must not be sent as "" — phone is unique-but-nullable,
        // and "" collides with every other user who also left it blank.
        phone: form.phone.trim() || null,

        ...(form.role === "worker" ? { skills: form.skills } : {}),
        // Any role that works at a hotel carries one; only a regional manager
        // is grouped instead.
        ...(form.role !== "regional_manager" ? { hotel_id: form.hotel_id } : {}),
        ...(form.role === "regional_manager" ? { hotel_group_id: form.hotel_group_id } : {}),
      },
      mode === "create" ? photo : null,
    );
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
        // Mandatory: see the photo input below.
        photo !== null &&
        // A manager needs a hotel, because the server requires a target GROUP
        // for an admin-created manager and derives it from that hotel
        // (createEmployee: "Admin must explicitly provide a
        // target_hotel_group_id"). Blocking submit here turns what would be a
        // server error naming a field this form never shows into an ordinary
        // unfilled selector.
        //
        // Deliberately NOT required for a regional manager: the server
        // accepts a null target for them, and requiring one would make the
        // form unusable on a system that has no hotel groups yet -- the exact
        // state an admin is in when setting the platform up.
        (form.role !== "manager" || !!form.hotel_id)));

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
                label={t("fields.temporaryPassword")}
                type="password"
                required
                autoComplete="new-password"
                minLength={8}
                hint="At least 8 characters."
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
              />

              <div className="sm:col-span-2">
                <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Profile photo <span className="text-red-600">*</span>
                </span>
                <div className="mt-1.5 flex items-center gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
                    {photoPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a local blob: preview URL, not a remote image next/image can optimise.
                      <img src={photoPreview} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <UserRound className="h-7 w-7 text-gray-400" />
                    )}
                  </div>
                  <input
                    type="file"
                    ref={photoInputRef}
                    className="hidden"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handlePhotoChange}
                    disabled={submitting}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={submitting}
                  >
                    <UploadCloud className="me-2 h-4 w-4" />
                    {photo ? "Change photo" : "Upload photo"}
                  </Button>
                </div>
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                  Required. JPEG, PNG, or WebP, up to 5 MB — this is what everyone sees on this
                  person&apos;s profile.
                </p>
                {photoError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{photoError}</p>}
              </div>
            </div>
          ) : (
            <Input label={t("fields.email")} value={form.email} disabled readOnly />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={t("fields.firstName")}
              required
              value={form.first_name}
              onChange={(e) => set("first_name", e.target.value)}
            />
            <Input
              label={t("fields.lastName")}
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

          {/* A hotel matters for anyone who works AT one, not just a manager.
              For a worker or checker it is what puts the applicant in front of
              the right reviewer: while the record is PENDING, scope falls back
              to these target fields, so an admin-created applicant with none
              is visible to nobody but an admin.

              Required for a manager in create mode -- see `valid` below: the
              server needs a target GROUP for an admin-created manager and
              derives it from this hotel, so leaving it blank fails the submit
              with a message about a field this form never showed. */}
          {(form.role === "manager" || form.role === "worker" || form.role === "checker") && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label={t("fields.assignedHotel")}
                value={form.hotel_id ?? ""}
                onChange={(e) => set("hotel_id", e.target.value)}
                options={[
                  { value: "", label: "Unassigned (leave vacant)" },
                  ...selectableHotels.map((h) => ({ value: h.id, label: h.name })),
                ]}
                disabled={!canEditRole}
                hint={
                  mode === "create" && form.role === "manager"
                    ? selectableHotels.length === 0
                      ? "No hotel belongs to a group yet. Put a hotel in a group first — a manager's group is taken from their hotel."
                      : "Required. The manager's hotel group is taken from this hotel."
                    : mode === "create"
                      ? "Optional. Without it, only an admin can review this application."
                      : undefined
                }
              />
            </div>
          )}

          {form.role === "regional_manager" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label={t("fields.assignedHotelGroup")}
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

          {form.role === "worker" && (
            <div className="space-y-4 rounded-md border border-gray-200 p-4 dark:border-gray-800">
                <div className="space-y-2 pt-2">
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
              label={t("fields.activeCanSignIn")}
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
                {t("common.cancel")}
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
