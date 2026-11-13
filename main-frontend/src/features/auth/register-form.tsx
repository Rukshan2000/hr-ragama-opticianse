"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { FormField, PasswordInput } from "@/components/shared/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SINGLE_TENANT } from "@/config/tenancy";
import { applyFieldErrors, errorMessage } from "@/lib/api/client";
import { authApi } from "@/lib/api/endpoints";
import { emailSchema, passwordSchema } from "@/lib/validation";
import { AuthCard, FormAlert } from "./auth-card";

const schema = z
  .object({
    name: z.string().trim().min(1, "Enter your name").max(150),
    email: emailSchema,
    organizationName: SINGLE_TENANT
      ? z.string().optional()
      : z.string().trim().min(2, "At least 2 characters").max(150),
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });

export function RegisterForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      email: "",
      organizationName: "",
      password: "",
      confirm: "",
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ confirm: _c, ...values }) => {
    setError(null);
    try {
      await authApi.register(
        SINGLE_TENANT ? { ...values, organizationName: undefined } : values,
      );
      qc.clear();
      toast.success(
        SINGLE_TENANT ? "Your account is ready" : "Your organization is ready",
      );
      router.replace("/");
    } catch (e) {
      if (!applyFieldErrors(e, form.setError)) setError(errorMessage(e));
    }
  });

  return (
    <AuthCard
      title={SINGLE_TENANT ? "Create your account" : "Create your organization"}
      description={
        SINGLE_TENANT
          ? "Sign up to get started."
          : "You'll be its administrator and can invite your team next."
      }
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <FormAlert>{error}</FormAlert>}
        <div
          className={SINGLE_TENANT ? "grid gap-4" : "grid gap-4 sm:grid-cols-2"}
        >
          <FormField label="Full name" error={errors.name?.message}>
            {(p) => (
              <Input {...p} autoComplete="name" {...form.register("name")} />
            )}
          </FormField>
          {!SINGLE_TENANT && (
            <FormField
              label="Organization"
              error={errors.organizationName?.message}
            >
              {(p) => (
                <Input
                  {...p}
                  autoComplete="organization"
                  {...form.register("organizationName")}
                />
              )}
            </FormField>
          )}
        </div>
        <FormField label="Work email" error={errors.email?.message}>
          {(p) => (
            <Input
              {...p}
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              {...form.register("email")}
            />
          )}
        </FormField>
        <FormField
          label="Password"
          error={errors.password?.message}
          hint="10+ characters with upper, lower case and a number"
        >
          {(p) => (
            <PasswordInput
              {...p}
              autoComplete="new-password"
              {...form.register("password")}
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
          {SINGLE_TENANT ? "Create account" : "Create organization"}
        </Button>
      </form>
    </AuthCard>
  );
}
