"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { FormField, PasswordInput } from "@/components/shared/form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { applyFieldErrors, errorMessage } from "@/lib/api/client";
import { authApi } from "@/lib/api/endpoints";
import { emailSchema, passwordSchema } from "@/lib/validation";
import { AuthCard, FormAlert } from "./auth-card";

const backToLogin = (
  <Link
    href="/login"
    className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
  >
    <ArrowLeft className="size-3.5" /> Back to sign in
  </Link>
);

export function ForgotPasswordForm() {
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(z.object({ email: emailSchema })),
    defaultValues: { email: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    try {
      setSent((await authApi.forgotPassword(email)).message);
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your account email and we'll send you a reset link."
      footer={backToLogin}
    >
      {sent ? (
        <FormAlert tone="success">{sent}</FormAlert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <FormAlert>{error}</FormAlert>}
          <FormField label="Email" error={errors.email?.message}>
            {(p) => (
              <Input
                {...p}
                type="email"
                autoComplete="email"
                {...form.register("email")}
              />
            )}
          </FormField>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={isSubmitting}
          >
            {isSubmitting && <Loader2 className="animate-spin" />}
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

const resetSchema = z
  .object({ newPassword: passwordSchema, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });

export function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(resetSchema),
    defaultValues: { newPassword: "", confirm: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ newPassword }) => {
    setError(null);
    try {
      await authApi.resetPassword({ token, newPassword });
      setDone(true);
    } catch (e) {
      if (!applyFieldErrors(e, form.setError)) setError(errorMessage(e));
    }
  });

  if (token.length < 20) {
    return (
      <AuthCard
        title="Invalid reset link"
        description="This link is missing or malformed."
        footer={backToLogin}
      >
        <FormAlert>Request a new link from the forgot password page.</FormAlert>
        <Link
          href="/forgot-password"
          className={buttonVariants({ size: "lg", className: "mt-4 w-full" })}
        >
          Request a new link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Choose a new password"
      description="All other sessions will be signed out."
      footer={backToLogin}
    >
      {done ? (
        <div className="space-y-4">
          <FormAlert tone="success">Your password has been reset.</FormAlert>
          <Link
            href="/login"
            className={buttonVariants({ size: "lg", className: "w-full" })}
          >
            Sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <FormAlert>{error}</FormAlert>}
          <FormField
            label="New password"
            error={errors.newPassword?.message}
            hint="10+ characters with upper, lower case and a number"
          >
            {(p) => (
              <PasswordInput
                {...p}
                autoComplete="new-password"
                {...form.register("newPassword")}
              />
            )}
          </FormField>
          <FormField label="Confirm password" error={errors.confirm?.message}>
            {(p) => (
              <PasswordInput
                {...p}
                autoComplete="new-password"
                {...form.register("confirm")}
              />
            )}
          </FormField>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={isSubmitting}
          >
            {isSubmitting && <Loader2 className="animate-spin" />}
            Reset password
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
