"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Brand } from "@/components/layout/brand";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { errorMessage } from "@/lib/api/client";
import { authApi } from "@/lib/api/endpoints";
import { AuthCard } from "./auth-card";
import { safeNext } from "./login-form";

export function SelectOrganization() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["auth", "me"], queryFn: authApi.me });
  const choose = useMutation({
    mutationFn: authApi.switchTenant,
    onSuccess: () => {
      qc.clear();
      router.replace(next);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-8">
      <Brand />
      <AuthCard
        title="Choose an organization"
        description="You belong to several organizations. Pick one to continue."
        footer={
          <Link
            href={next}
            className="font-medium text-foreground hover:underline"
          >
            Continue without an organization
          </Link>
        }
      >
        {me.isPending ? (
          <LoadingState rows={3} />
        ) : me.error ? (
          <ErrorState message={me.error.message} onRetry={() => me.refetch()} />
        ) : (
          <ul className="space-y-2">
            {me.data.tenants.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={choose.isPending}
                  onClick={() => choose.mutate(t.slug)}
                  className="group flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors outline-none hover:border-border-strong hover:bg-subtle/50 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
                >
                  <span className="grid size-9 place-items-center rounded-[10px] bg-subtle text-sm font-semibold text-brand-accent">
                    {t.name[0]!.toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {t.name}
                    </span>
                    <span className="block truncate text-xs text-text-muted">
                      {t.slug}
                    </span>
                  </span>
                  {choose.isPending && choose.variables === t.slug ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <ArrowRight className="size-4 text-text-muted transition-transform group-hover:translate-x-0.5" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </AuthCard>
    </div>
  );
}
