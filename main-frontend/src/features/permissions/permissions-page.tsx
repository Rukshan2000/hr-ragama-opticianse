"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, KeyRound, Minus } from "lucide-react";
import { toast } from "sonner";
import { ContentCard, PageContainer, PageHeader } from "@/components/shared/page";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { Checkbox } from "@/components/ui/checkbox";
import { actionLabel, groupPermissions } from "@/features/roles/permission-groups";
import { useAssignablePermissions, useRoleMutations } from "@/features/roles/use-roles";
import { useSession } from "@/hooks/use-session";
import { rolesApi } from "@/lib/api/endpoints";
import type { Role } from "@/lib/api/types";

export function PermissionsPage() {
  const { can } = useSession();
  const canReadRoles = can("roles:read");
  const canManage = can("roles:manage");
  const catalog = useAssignablePermissions();
  // ponytail: matrix shows the first 100 roles (backend page cap); paginate columns if tenants exceed that.
  const roles = useQuery({ queryKey: ["roles", "all"], queryFn: () => rolesApi.list({ limit: 100, sort: "name", order: "asc" }), enabled: canReadRoles });
  const { update } = useRoleMutations();

  const toggle = (role: Role, key: string, on: boolean) => {
    const permissions = on ? [...role.permissions, key] : role.permissions.filter((k) => k !== key);
    update.mutate({ id: role.id, permissions }, { onSuccess: () => toast.success(`${role.name}: ${on ? "granted" : "revoked"} ${key}`) });
  };

  const loading = catalog.isPending || (canReadRoles && roles.isPending);
  const error = catalog.error ?? roles.error;
  const roleList = roles.data?.items ?? [];

  return (
    <PageContainer>
      <PageHeader
        title="Permissions"
        description={canManage ? "Grant or revoke permissions per role. Changes apply immediately." : "What each role in this organization can do."}
      />
      <ContentCard bodyClassName="p-0">
        {loading ? (
          <LoadingState className="p-5" />
        ) : error ? (
          <ErrorState message={error.message} onRetry={() => (catalog.refetch(), roles.refetch())} />
        ) : catalog.permissions.length === 0 ? (
          <EmptyState icon={KeyRound} title="No permissions available" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle bg-subtle/50">
                  <th scope="col" className="sticky left-0 z-10 min-w-64 bg-subtle px-5 py-3 text-left text-xs font-medium text-muted-foreground">
                    Permission
                  </th>
                  {roleList.map((r) => (
                    <th key={r.id} scope="col" className="min-w-24 px-3 py-3 text-center text-xs font-medium text-muted-foreground">
                      {r.name}
                    </th>
                  ))}
                </tr>
              </thead>
              {groupPermissions(catalog.permissions).map((g) => (
                <tbody key={g.resource}>
                  <tr className="border-b border-border-subtle">
                    <th colSpan={roleList.length + 1} scope="colgroup" className="sticky left-0 bg-card px-5 pt-4 pb-2 text-left text-[11px] font-semibold tracking-wider text-text-muted uppercase">
                      {g.label}
                    </th>
                  </tr>
                  {g.permissions.map((p) => (
                    <tr key={p.key} className="border-b border-border-subtle last:border-0 hover:bg-subtle/30">
                      <th scope="row" className="sticky left-0 z-10 bg-card px-5 py-3 text-left font-normal">
                        <span className="block text-[13px] font-medium">{actionLabel(p.key)}</span>
                        <span className="block text-xs text-muted-foreground">{p.description ?? p.key}</span>
                      </th>
                      {roleList.map((r) => {
                        const has = r.permissions.includes(p.key);
                        return (
                          <td key={r.id} className="px-3 py-3 text-center">
                            {canManage ? (
                              <Checkbox
                                checked={has}
                                disabled={update.isPending}
                                aria-label={`${p.key} for ${r.name}`}
                                onCheckedChange={(on) => toggle(r, p.key, on)}
                              />
                            ) : has ? (
                              <Check className="mx-auto size-4 text-success" aria-label="Granted" />
                            ) : (
                              <Minus className="mx-auto size-4 text-text-muted" aria-label="Not granted" />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </ContentCard>
    </PageContainer>
  );
}
