"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Check, Loader2, LogOut } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { StatusBadge, UserAvatar } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormField, PasswordInput } from "@/components/shared/form";
import {
  ContentCard,
  PageContainer,
  PageHeader,
} from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/features/auth/auth-card";
import { SINGLE_TENANT } from "@/config/tenancy";
import { useSwitchTenant } from "@/features/auth/use-auth-actions";
import { useSession } from "@/hooks/use-session";
import { applyFieldErrors, errorMessage } from "@/lib/api/client";
import { authApi } from "@/lib/api/endpoints";
import { formatDate, formatDateTime } from "@/lib/format";
import { passwordSchema } from "@/lib/validation";
import { MfaCard } from "./mfa-card";
import { PasskeysCard } from "./passkeys-card";
import { NotificationPreferences } from "@/features/hr/admin";

const pwSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: "Must differ from the current password",
    path: ["newPassword"],
  });

function useSignedOut() {
  const router = useRouter();
  const qc = useQueryClient();
  return () => {
    router.replace("/login");
    qc.clear();
  };
}

function ChangePassword() {
  const signedOut = useSignedOut();
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(pwSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirm: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const onSubmit = form.handleSubmit(
    async ({ currentPassword, newPassword }) => {
      setError(null);
      try {
        await authApi.changePassword({ currentPassword, newPassword });
        toast.success("Password changed. Please sign in again.");
        signedOut(); // backend revokes every session on password change
      } catch (e) {
        if (!applyFieldErrors(e, form.setError)) setError(errorMessage(e));
      }
    },
  );
  return (
    <ContentCard
      title="Password"
      description="Changing your password signs you out everywhere."
    >
      <form onSubmit={onSubmit} className="max-w-md space-y-4" noValidate>
        {error && <FormAlert>{error}</FormAlert>}
        <FormField
          label="Current password"
          error={errors.currentPassword?.message}
        >
          {(p) => (
            <PasswordInput
              {...p}
              autoComplete="current-password"
              {...form.register("currentPassword")}
            />
          )}
        </FormField>
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
        <FormField label="Confirm new password" error={errors.confirm?.message}>
          {(p) => (
            <PasswordInput
              {...p}
              autoComplete="new-password"
              {...form.register("confirm")}
            />
          )}
        </FormField>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          Update password
        </Button>
      </form>
    </ContentCard>
  );
}

export function SettingsPage() {
  const { me } = useSession();
  const switchTenant = useSwitchTenant();
  const [confirm, setConfirm] = useState(false);
  const signedOut = useSignedOut();
  const logoutAll = useMutation({
    mutationFn: authApi.logoutAll,
    onSuccess: signedOut,
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!me) return null;
  const inTenantForHr = Boolean(me.tenant);

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        title="Settings"
        description={
          SINGLE_TENANT
            ? "Your profile and security."
            : "Your profile, organizations and security."
        }
      />
      <ContentCard title="Profile">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <UserAvatar name={me.name} size="lg" />
          <dl className="grid flex-1 gap-2 sm:grid-cols-3">
            {[
              ["Name", me.name],
              ["Email", me.email],
              ["Member since", formatDate(me.createdAt)],
            ].map(([k, v]) => (
              <div
                key={k}
                className="rounded-lg border bg-subtle/40 px-3 py-2.5"
              >
                <dt className="text-[11px] font-medium tracking-wide text-text-muted uppercase">
                  {k}
                </dt>
                <dd className="mt-0.5 truncate text-[13px] font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </ContentCard>

      {!SINGLE_TENANT && me.tenants.length > 0 && (
        <ContentCard
          title="Organizations"
          description="Switch the organization you're working in."
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-border-subtle">
            {me.tenants.map((t) => {
              const current = t.id === me.tenant?.id;
              return (
                <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="grid size-8 place-items-center rounded-lg bg-subtle text-xs font-semibold text-brand-accent">
                    {t.name[0]!.toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{t.name}</p>
                    <p className="truncate text-xs text-text-muted">{t.slug}</p>
                  </div>
                  {current ? (
                    <StatusBadge tone="success">
                      <Check className="size-3" /> Current
                    </StatusBadge>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={switchTenant.isPending}
                      onClick={() => switchTenant.mutate(t.slug)}
                    >
                      Switch
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </ContentCard>
      )}

      <ChangePassword />

      <MfaCard />

      <PasskeysCard />
      {inTenantForHr && <NotificationPreferences />}

      <ContentCard
        title="Sessions"
        description={`Last sign-in ${formatDateTime(me.lastLoginAt)}.`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-muted-foreground">
            Sign out of every device, including this one.
          </p>
          <Button variant="outline" onClick={() => setConfirm(true)}>
            <LogOut /> Sign out everywhere
          </Button>
        </div>
      </ContentCard>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Sign out everywhere?"
        description="All active sessions will be revoked. You'll need to sign in again."
        confirmLabel="Sign out everywhere"
        destructive
        pending={logoutAll.isPending}
        onConfirm={() => logoutAll.mutate()}
      />
    </PageContainer>
  );
}
