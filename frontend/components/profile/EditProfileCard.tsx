"use client";

import { useState } from "react";
import { mutate as globalMutate } from "swr";
import { authApi } from "@/lib/api";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormError,
  Input,
  Modal,
} from "@/components/ui";
import type { AuthUser } from "@/lib/types";
import { useTranslation } from "react-i18next";

/**
 * Self-service profile editing and password reset.
 *
 * `PUT /auth/profile` has existed in the backend since the auth module was
 * built, but no client method ever called it — the profile page was read-only,
 * so nobody could change their own name or phone number. Likewise the password
 * reset flow (`POST /auth/password-reset`) was reachable only from the
 * logged-OUT login screen, so a signed-in user had no way to trigger one.
 */
export function EditProfileCard({ user }: { user: AuthUser }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState(user.first_name);
  const [lastName, setLastName] = useState(user.last_name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const save = useAsyncAction();

  const [resetOpen, setResetOpen] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const reset = useAsyncAction();

  const openEdit = () => {
    // Re-seed from the current user each time, so cancelling and reopening
    // doesn't show stale edits from the previous attempt.
    setFirstName(user.first_name);
    setLastName(user.last_name);
    setPhone(user.phone ?? "");
    setFieldError(null);
    setOpen(true);
  };

  const onSave = () => {
    setFieldError(null);
    if (!firstName.trim() || !lastName.trim()) {
      setFieldError("First and last name are required.");
      return;
    }
    // Backend requires E.164 when phone is present (auth/validation.ts). Check
    // here too so the user gets a field-level message instead of a 400.
    const trimmedPhone = phone.trim();
    if (trimmedPhone && !/^\+?[1-9]\d{1,14}$/.test(trimmedPhone)) {
      setFieldError("Phone must be a valid international number, e.g. +49301234567.");
      return;
    }

    save.run(
      () =>
        authApi.updateProfile({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          // Omit rather than send "" — the backend treats an absent field as
          // "leave unchanged", and "" would fail the E.164 regex.
          ...(trimmedPhone ? { phone: trimmedPhone } : {}),
        }),
      {
        onSuccess: async () => {
          await globalMutate("/auth/me");
          setOpen(false);
        },
        errorMessage: "Could not save your profile. Please try again.",
      },
    );
  };

  const onRequestReset = () =>
    reset.run(() => authApi.requestPasswordReset(user.email), {
      onSuccess: () => setResetSent(true),
      errorMessage: "Could not start a password reset. Please try again.",
    });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("users.accountSettings")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Update your name and contact details, or reset your password.
          </p>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" onClick={openEdit}>
              Edit profile
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setResetSent(false);
                setResetOpen(true);
              }}
            >
              Reset password
            </Button>
          </div>
        </CardContent>
      </Card>

      <Modal
        open={open}
        onClose={() => !save.pending && setOpen(false)}
        title={t("profile.editTitle")}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={save.pending}>
              Cancel
            </Button>
            <Button onClick={onSave} loading={save.pending}>
              Save changes
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label={t("fields.firstName")}
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
          <Input
            label={t("fields.lastName")}
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
          <Input
            label={t("fields.phoneOptional")}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+49301234567"
          />
          {/* Email is deliberately not editable here: it is the account
              identifier and changing it needs a verification round-trip the
              backend does not implement yet. */}
          <FormError>{fieldError ?? save.error}</FormError>
        </div>
      </Modal>

      <Modal
        open={resetOpen}
        onClose={() => !reset.pending && setResetOpen(false)}
        title={t("profile.resetPasswordTitle")}
        footer={
          <>
            <Button variant="outline" onClick={() => setResetOpen(false)} disabled={reset.pending}>
              {resetSent ? "Close" : "Cancel"}
            </Button>
            {!resetSent && (
              <Button onClick={onRequestReset} loading={reset.pending}>
                Send reset link
              </Button>
            )}
          </>
        }
      >
        {resetSent ? (
          <p className="text-sm text-gray-700 dark:text-gray-300">
            If an account exists for <span className="font-medium">{user.email}</span>, a
            password reset link is on its way. The link expires shortly, so use it soon.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              We&apos;ll email a reset link to{" "}
              <span className="font-medium">{user.email}</span>. Your current password
              stays active until you complete the reset.
            </p>
            <FormError>{reset.error}</FormError>
          </div>
        )}
      </Modal>
    </>
  );
}
