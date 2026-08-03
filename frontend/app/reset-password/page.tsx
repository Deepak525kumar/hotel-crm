"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { authApi } from "@/lib/api";
import { ApiError } from "@/lib/api";
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
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  // Security Review FINDING: Remove token from URL to prevent referer leakage
  if (typeof window !== "undefined" && token) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError("Invalid or missing reset token.");
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
      <div className="text-center text-sm text-gray-600 py-4">
        <p className="mb-4">Invalid password reset link. The token is missing.</p>
        <Link href="/forgot-password" className="text-blue-600 hover:underline">
          Request a new link
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div className="text-center text-sm text-gray-600 py-4">
        <p className="mb-4 text-green-600 font-medium">Your password has been reset successfully!</p>
        <Link href="/login" className="text-blue-600 hover:underline">
          Return to login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-gray-600">
        Enter a new password for your account.
      </p>
      <Input
        label="New Password"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <FormError>{error}</FormError>
      <Button type="submit" loading={submitting} className="w-full">
        Reset Password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Set New Password</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<div className="text-center text-sm text-gray-500 py-4">Loading...</div>}>
            <ResetPasswordForm />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
