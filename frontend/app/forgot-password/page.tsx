"use client";

import { useState } from "react";

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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authApi.requestPasswordReset(email);
      setSuccess(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError(
          err.retryAfterSeconds !== undefined
            ? `Too many attempts. Please try again in ${err.retryAfterSeconds}s.`
            : "Too many attempts. Please wait before trying again."
        );
      } else {
        setError(
          err instanceof ApiError
            ? err.message
            : "Something went wrong. Please try again."
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
        </CardHeader>
        <CardContent>
          {success ? (
            <div className="flex flex-col gap-4 text-center">
              <p className="text-sm text-gray-600">
                If that email exists, a password reset link has been sent to it.
              </p>
              <Link href="/login" className="text-sm text-blue-600 hover:underline">
                Return to login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <p className="text-sm text-gray-600">
                Enter your email address and we will send you a link to reset your password.
              </p>
              <Input
                label="Email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <FormError>{error}</FormError>
              <Button type="submit" loading={submitting} className="w-full">
                Send reset link
              </Button>
              <div className="text-center mt-2">
                <Link href="/login" className="text-sm text-blue-600 hover:underline">
                  Back to login
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
