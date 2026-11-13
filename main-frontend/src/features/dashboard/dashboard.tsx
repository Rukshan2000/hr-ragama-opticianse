"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, Building2, KeyRound, Plus, ShieldCheck, UserCheck, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { StatusBadge, UserAvatar, ActiveBadge } from "@/components/shared/badges";
import { ContentCard, PageContainer, StatCard } from "@/components/shared/page";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { healthApi, rolesApi, tenantsApi, usersApi } from "@/lib/api/endpoints";
import { formatDate, formatDateTime } from "@/lib/format";
import { useSession } from "@/hooks/use-session";
import { HrDashboard } from "@/features/hr/dashboard";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** Totals come from list meta (limit=1), so no endpoint is invented for counts. */
const total = (q: { data?: { meta: { total: number } } }) => q.data?.meta.total.toLocaleString();

function SystemStatusCard() {
  const health = useQuery({ queryKey: ["health"], queryFn: healthApi.ready, refetchInterval: 60_000, retry: false });
  const up = health.data?.status === "ready";
  return (
    <StatCard
      label="System status"
      icon={Activity}
      loading={health.isPending}
      value={
        <StatusBadge tone={up ? "success" : "danger"} className="h-7 text-[13px]">
          {up ? "Operational" : "Degraded"}
        </StatusBadge>
      }
      hint={up ? "API and database reachable" : health.error?.message ?? "Database unreachable"}
    />
  );
}

function QuickAction({ href, icon: Icon, label, description }: { href: string; icon: LucideIcon; label: string; description: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border p-3 transition-colors outline-none hover:border-border-strong hover:bg-subtle/50 focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-subtle text-brand-accent">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{description}</span>
      </span>
      <ArrowRight className="size-4 text-text-muted transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function TenantDashboard() {
  const { can } = useSession();
  const canUsers = can("users:read");
  const canRoles = can("roles:read");
  const users = useQuery({ queryKey: ["users", "count"], queryFn: () => usersApi.list({ limit: 1 }), enabled: canUsers });
  const active = useQuery({ queryKey: ["users", "count", "active"], queryFn: () => usersApi.list({ limit: 1, isActive: true }), enabled: canUsers });
  const roles = useQuery({ queryKey: ["roles", "count"], queryFn: () => rolesApi.list({ limit: 1 }), enabled: canRoles });
  const recent = useQuery({
    queryKey: ["users", "recent"],
    queryFn: () => usersApi.list({ limit: 5, sort: "createdAt", order: "desc" }),
    enabled: canUsers,
  });

  const actions = [
    can("users:create") && { href: "/users?new=1", icon: Plus, label: "Add a user", description: "Invite someone to this organization" },
    canUsers && { href: "/users", icon: Users, label: "Manage users", description: "Status, roles and access" },
    can("roles:manage") && { href: "/roles", icon: ShieldCheck, label: "Configure roles", description: "Group permissions into roles" },
    can("permissions:read") && { href: "/permissions", icon: KeyRound, label: "Review permissions", description: "See who can do what" },
  ].filter(Boolean) as { href: string; icon: LucideIcon; label: string; description: string }[];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {canUsers && <StatCard label="Users" icon={Users} loading={users.isPending} value={total(users) ?? "—"} hint="Members of this organization" />}
        {canUsers && (
          <StatCard
            label="Active users"
            icon={UserCheck}
            loading={active.isPending || users.isPending}
            value={total(active) ?? "—"}
            hint={users.data && active.data && users.data.meta.total > 0 ? `${Math.round((active.data.meta.total / users.data.meta.total) * 100)}% of members` : "Can sign in"}
          />
        )}
        {canRoles && <StatCard label="Roles" icon={ShieldCheck} loading={roles.isPending} value={total(roles) ?? "—"} hint="Defined in this organization" />}
        <SystemStatusCard />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {canUsers && (
          <ContentCard
            title="Recently joined"
            description="Newest members of this organization"
            bodyClassName="p-0"
            actions={
              <Link href="/users" className="text-[13px] font-medium text-brand-accent hover:underline">
                View all
              </Link>
            }
          >
            {recent.isPending ? (
              <LoadingState className="p-5" rows={4} />
            ) : recent.error ? (
              <ErrorState message={recent.error.message} onRetry={() => recent.refetch()} />
            ) : recent.data.items.length === 0 ? (
              <EmptyState icon={Users} title="No members yet" />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {recent.data.items.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 px-5 py-3">
                    <UserAvatar name={u.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{u.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                    </div>
                    <span className="hidden text-xs text-text-muted sm:block">Joined {formatDate(u.joinedAt)}</span>
                    <ActiveBadge active={u.isActive} />
                  </li>
                ))}
              </ul>
            )}
          </ContentCard>
        )}
        <ContentCard title="Quick actions" bodyClassName="space-y-2">
          {actions.length ? actions.map((a) => <QuickAction key={a.href} {...a} />) : (
            <QuickAction href="/settings" icon={KeyRound} label="Account settings" description="Password and sessions" />
          )}
        </ContentCard>
      </div>
    </>
  );
}

function PlatformDashboard() {
  const { can } = useSession();
  const canTenants = can("tenants:read");
  const tenants = useQuery({ queryKey: ["tenants", "count"], queryFn: () => tenantsApi.list({ limit: 1 }), enabled: canTenants });
  const active = useQuery({ queryKey: ["tenants", "count", "active"], queryFn: () => tenantsApi.list({ limit: 1, isActive: true }), enabled: canTenants });
  const recent = useQuery({ queryKey: ["tenants", "recent"], queryFn: () => tenantsApi.list({ limit: 5, sort: "createdAt", order: "desc" }), enabled: canTenants });

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {canTenants && <StatCard label="Tenants" icon={Building2} loading={tenants.isPending} value={total(tenants) ?? "—"} hint="Organizations on the platform" />}
        {canTenants && <StatCard label="Active tenants" icon={UserCheck} loading={active.isPending} value={total(active) ?? "—"} hint="Members can sign in" />}
        <SystemStatusCard />
      </div>
      {canTenants && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <ContentCard
            title="Newest tenants"
            bodyClassName="p-0"
            actions={
              <Link href="/tenants" className="text-[13px] font-medium text-brand-accent hover:underline">
                View all
              </Link>
            }
          >
            {recent.isPending ? (
              <LoadingState className="p-5" rows={4} />
            ) : recent.error ? (
              <ErrorState message={recent.error.message} onRetry={() => recent.refetch()} />
            ) : recent.data.items.length === 0 ? (
              <EmptyState icon={Building2} title="No tenants yet" />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {recent.data.items.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="grid size-7 place-items-center rounded-lg bg-subtle text-[11px] font-semibold text-brand-accent">{t.name[0]!.toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{t.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{t.slug}</p>
                    </div>
                    <span className="hidden text-xs text-text-muted sm:block">{formatDate(t.createdAt)}</span>
                    <ActiveBadge active={t.isActive} />
                  </li>
                ))}
              </ul>
            )}
          </ContentCard>
          <ContentCard title="Quick actions" bodyClassName="space-y-2">
            {can("tenants:manage") && <QuickAction href="/tenants?new=1" icon={Plus} label="Create a tenant" description="Provision an organization" />}
            <QuickAction href="/tenants" icon={Building2} label="Manage tenants" description="Status and details" />
          </ContentCard>
        </div>
      )}
    </>
  );
}

export function Dashboard() {
  const { me, inTenant } = useSession();
  if (!me) return null;
  return (
    <PageContainer>
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <UserAvatar name={me.name} size="lg" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {greeting()}, {me.name.split(" ")[0]}
            </h1>
            <p className="text-[13px] text-muted-foreground">
              {inTenant ? `You're working in ${me.tenant!.name}.` : "You're in the platform administration context."} Last sign-in{" "}
              {formatDateTime(me.lastLoginAt)}.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {me.roles.map((r) => (
            <StatusBadge key={r.id} tone="info" dot={false}>
              {r.name}
            </StatusBadge>
          ))}
        </div>
      </div>
      {inTenant ? (
        <>
          <HrDashboard />
          <TenantDashboard />
        </>
      ) : (
        <PlatformDashboard />
      )}
    </PageContainer>
  );
}
