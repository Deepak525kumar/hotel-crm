"use client";

import { useState, Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { authApi } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormError,
  Input,
} from "@/components/ui";

function ResetPasswordForm() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const urlToken = searchParams.get("token");
  
  // We must handle the case where searchParams is empty on initial SSR/hydration,
  // then populates, and ALSO handle the fact that we scrub the URL (which might
  // cause searchParams to become empty again). State is the only safe place.
  const [token, setToken] = useState<string | null>(urlToken);

  useEffect(() => {
    if (urlToken && !token) {
      setToken(urlToken);
    }
    
    // Security Review FINDING: Remove token from URL to prevent referer leakage
    if (urlToken && typeof window !== "undefined") {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [urlToken, token]);

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError(t("auth.invalidResetTokenMissing"));
      return;
    }
    
    setError(null);
    setSubmitting(true);
    try {
      await authApi.confirmPasswordReset(token, password);
      setSuccess(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="text-center text-sm text-gray-600 py-4 dark:text-gray-300">
        <p className="mb-4">{t("auth.invalidResetLink")}</p>
        <Link href="/forgot-password" className="text-blue-600 hover:underline dark:text-blue-400">
          {t("auth.requestNewLink")}
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div className="text-center text-sm text-gray-600 py-4 dark:text-gray-300">
        <p className="mb-4 text-green-600 font-medium dark:text-green-400">{t("auth.resetSuccess")}</p>
        <Link href="/login" className="text-blue-600 hover:underline dark:text-blue-400">
          {t("auth.returnToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {t("auth.enterNewPasswordHint")}
      </p>
      <Input
        label={t("fields.newPassword")}
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <FormError>{error}</FormError>
      <Button type="submit" loading={submitting} className="w-full">
        {t("auth.resetPasswordTitle")}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-800">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("auth.setNewPassword")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<div className="text-center text-sm text-gray-500 py-4 dark:text-gray-400">{t("common.loading")}</div>}>
            <ResetPasswordForm />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
