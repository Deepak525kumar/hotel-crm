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
  // Captured ONCE, on mount. Two things make `searchParams` stop reporting the
  // token, and either one leaves the form in the "link is invalid" state --
  // the bug this file has now hit twice:
  //   1. the effect below deliberately scrubs it out of the URL;
  //   2. a render pass without the query string reports nothing.
  // A lazy initializer latches it before either can happen, with no ref read
  // during render (react-compiler forbids it) and no setState inside an effect
  // (react-hooks/set-state-in-effect forbids it, and it costs a render pass).
  const [token] = useState<string | null>(() => searchParams.get("token"));

  // Security Review FINDING: remove the token from the URL to prevent referer
  // leakage. In an effect, never during render -- mutating history while
  // rendering is what stripped the token before it could be read.
  useEffect(() => {
    if (token && typeof window !== "undefined") {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [token]);

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
