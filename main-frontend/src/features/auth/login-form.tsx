"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Fingerprint, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { FormField, PasswordInput } from "@/components/shared/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { applyFieldErrors, errorMessage } from "@/lib/api/client";
import { authApi } from "@/lib/api/endpoints";
import { emailSchema } from "@/lib/validation";
import { AuthCard, FormAlert } from "./auth-card";
import { PasskeyCancelled, usePasskeysSupported, signInWithPasskey } from "./passkey";
import type { MfaTicket, SessionResult } from "@/lib/api/types";
import { MfaStep } from "./mfa-step";

const schema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password"),
});

/** Only allow same-site relative redirects. */
export function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const [passkeyPending, setPasskeyPending] = useState(false);
  const [ticket, setTicket] = useState<MfaTicket | null>(null);
  const canPasskey = usePasskeysSupported();

  const enter = (data: SessionResult) => {
    qc.clear();
    const next = safeNext(params.get("next"));
    router.replace(
      !data.tenant && data.tenants.length > 1
        ? `/select-organization?next=${encodeURIComponent(next)}`
        : next,
    );
  };

  const onPasskey = async () => {
    setError(null);
    setPasskeyPending(true);
    try {
      // A typed, valid email narrows the prompt to that account; otherwise discoverable login.
      const email = emailSchema.safeParse(form.getValues("email"));
      const { data } = await signInWithPasskey(email.success ? email.data : undefined);
      toast.success("Signed in with passkey");
      enter(data);
    } catch (e) {
      if (!(e instanceof PasskeyCancelled)) setError(errorMessage(e));
    } finally {
      setPasskeyPending(false);
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const { data } = await authApi.login(values);
      if ("mfaRequired" in data) setTicket(data);
      else enter(data);
    } catch (e) {
      if (!applyFieldErrors(e, form.setError)) setError(errorMessage(e));
    }
  });

  if (ticket) {
    return (
      <MfaStep
        ticket={ticket}
        onSuccess={enter}
        onCancel={() => {
          setTicket(null);
          form.resetField("password");
        }}
      />
    );
  }

  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to your workspace to continue."
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <FormAlert>{error}</FormAlert>}
        <FormField label="Email" error={errors.email?.message}>
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
          action={
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-brand-accent hover:underline"
            >
              Forgot password?
            </Link>
          }
        >
          {(p) => (
            <PasswordInput
              {...p}
              autoComplete="current-password"
              {...form.register("password")}
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
          Sign in
        </Button>
        {canPasskey && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full"
            disabled={passkeyPending || isSubmitting}
            onClick={onPasskey}
          >
            {passkeyPending ? <Loader2 className="animate-spin" /> : <Fingerprint />}
            Sign in with a passkey
          </Button>
        )}
      </form>
    </AuthCard>
  );
}
