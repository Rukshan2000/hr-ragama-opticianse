"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, Eye, Plus, Power, PowerOff } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ActionDropdown } from "@/components/shared/action-dropdown";
import { ActiveBadge } from "@/components/shared/badges";
import { DataTable, FilterDropdown, Pagination, SearchInput, type Column } from "@/components/shared/data-table";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { useListState } from "@/hooks/use-list-state";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/api/client";
import { tenantsApi } from "@/lib/api/endpoints";
import type { Tenant } from "@/lib/api/types";
import { formatDate } from "@/lib/format";
import { CreateTenantDialog, TenantSheet, useTenantInvalidate } from "./tenant-dialogs";

type StatusFilter = "all" | "active" | "inactive";

export function TenantsPage() {
  const { can } = useSession();
  const canManage = can("tenants:manage");
  const params = useSearchParams();
  const router = useRouter();
  const list = useListState({ sort: "createdAt", order: "desc" }, params.get("search") ?? "");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [creating, setCreating] = useState(params.get("new") === "1" && canManage);
  const [viewing, setViewing] = useState<Tenant | null>(null);
  const invalidate = useTenantInvalidate();

  const { setSearch } = list;
  const urlSearch = params.get("search");
  useEffect(() => {
    if (urlSearch !== null) {
      setSearch(urlSearch);
      router.replace("/tenants");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSearch]);

  const tenants = useQuery({
    queryKey: ["tenants", "list", list.params, status],
    queryFn: () => tenantsApi.list({ ...list.params, isActive: status === "all" ? undefined : status === "active" }),
    placeholderData: (p) => p,
  });
  const toggle = useMutation({
    mutationFn: (t: Tenant) => tenantsApi.update(t.id, { isActive: !t.isActive }),
    onSuccess: (r) => {
      toast.success(r.data.isActive ? "Tenant activated" : "Tenant deactivated");
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: Column<Tenant>[] = [
    {
      key: "name",
      header: "Tenant",
      sortKey: "name",
      cell: (t) => (
        <div className="flex items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-subtle text-xs font-semibold text-brand-accent">{t.name[0]!.toUpperCase()}</span>
          <p className="truncate font-medium">{t.name}</p>
        </div>
      ),
    },
    { key: "slug", header: "Slug", sortKey: "slug", hideBelow: "sm", cell: (t) => <code className="rounded-md bg-subtle px-1.5 py-0.5 font-mono text-xs">{t.slug}</code> },
    { key: "status", header: "Status", cell: (t) => <ActiveBadge active={t.isActive} /> },
    { key: "created", header: "Created", sortKey: "createdAt", hideBelow: "md", cell: (t) => <span className="text-muted-foreground">{formatDate(t.createdAt)}</span> },
    {
      key: "actions",
      header: "",
      className: "w-12 text-right",
      cell: (t) => (
        <div onClick={(e) => e.stopPropagation()}>
          <ActionDropdown
            items={[
              { label: "View details", icon: Eye, onSelect: () => setViewing(t) },
              { label: t.isActive ? "Deactivate" : "Activate", icon: t.isActive ? PowerOff : Power, hidden: !canManage, onSelect: () => toggle.mutate(t) },
            ]}
          />
        </div>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Tenants"
        description="Organizations on the platform."
        actions={
          canManage && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Create tenant
            </Button>
          )
        }
      />
      <DataTable
        columns={columns}
        rows={tenants.data?.items}
        rowKey={(t) => t.id}
        loading={tenants.isPending}
        error={tenants.error?.message}
        onRetry={() => tenants.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={setViewing}
        toolbar={
          <>
            <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search name or slug" />
            <FilterDropdown<StatusFilter>
              label="Status"
              value={status}
              onChange={(v) => {
                setStatus(v);
                list.setPage(1);
              }}
              options={[
                { value: "all", label: "All statuses" },
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
              ]}
            />
          </>
        }
        empty={<EmptyState icon={Building2} title={list.params.search || status !== "all" ? "No tenants match your filters" : "No tenants yet"} />}
        footer={<Pagination meta={tenants.data?.meta} onPageChange={list.setPage} />}
      />
      <CreateTenantDialog open={creating} onOpenChange={setCreating} />
      <TenantSheet tenant={viewing} onOpenChange={(o) => !o && setViewing(null)} />
    </PageContainer>
  );
}
