"use client";

import { Eye, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { ActionDropdown } from "@/components/shared/action-dropdown";
import { StatusBadge } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, Pagination, SearchInput, type Column } from "@/components/shared/data-table";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { useListState } from "@/hooks/use-list-state";
import { useSession } from "@/hooks/use-session";
import type { Role } from "@/lib/api/types";
import { formatDate } from "@/lib/format";
import { RoleSheet } from "./role-sheet";
import { useRoleMutations, useRoles } from "./use-roles";

export function RolesPage() {
  const { can } = useSession();
  const canManage = can("roles:manage");
  const list = useListState({ sort: "name", order: "asc" });
  const roles = useRoles(list.params);
  const { remove } = useRoleMutations();
  const [editing, setEditing] = useState<{ role: Role | null } | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);

  const columns: Column<Role>[] = [
    {
      key: "name",
      header: "Role",
      sortKey: "name",
      cell: (r) => (
        <div className="flex items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-subtle text-brand-accent">
            <ShieldCheck className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{r.name}</p>
            <p className="truncate text-xs text-muted-foreground">{r.description ?? r.slug}</p>
          </div>
        </div>
      ),
    },
    { key: "perms", header: "Permissions", cell: (r) => <span className="tabular-nums">{r.permissions.length}</span> },
    { key: "type", header: "Type", hideBelow: "sm", cell: (r) => <StatusBadge tone={r.isSystem ? "info" : "neutral"} dot={false}>{r.isSystem ? "System" : "Custom"}</StatusBadge> },
    { key: "created", header: "Created", sortKey: "createdAt", hideBelow: "md", cell: (r) => <span className="text-muted-foreground">{formatDate(r.createdAt)}</span> },
    {
      key: "actions",
      header: "",
      className: "w-12 text-right",
      cell: (r) => (
        <div onClick={(e) => e.stopPropagation()}>
          <ActionDropdown
            items={[
              { label: canManage ? "Edit" : "View", icon: canManage ? Pencil : Eye, onSelect: () => setEditing({ role: r }) },
              { label: "Delete", icon: Trash2, destructive: true, hidden: !canManage || r.isSystem, onSelect: () => setDeleting(r) },
            ]}
          />
        </div>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Roles"
        description="Roles bundle permissions. Users get the union of their roles' permissions."
        actions={
          canManage && (
            <Button onClick={() => setEditing({ role: null })}>
              <Plus /> New role
            </Button>
          )
        }
      />
      <DataTable
        columns={columns}
        rows={roles.data?.items}
        rowKey={(r) => r.id}
        loading={roles.isPending}
        error={roles.error?.message}
        onRetry={() => roles.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={(r) => setEditing({ role: r })}
        toolbar={<SearchInput value={list.search} onChange={list.setSearch} placeholder="Search roles" />}
        empty={<EmptyState icon={ShieldCheck} title={list.params.search ? "No roles match your search" : "No roles yet"} />}
        footer={<Pagination meta={roles.data?.meta} onPageChange={list.setPage} />}
      />
      <RoleSheet open={Boolean(editing)} role={editing?.role ?? null} readOnly={!canManage} onOpenChange={(o) => !o && setEditing(null)} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        description="Users with this role will lose its permissions. This cannot be undone."
        confirmLabel="Delete role"
        destructive
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
      />
    </PageContainer>
  );
}
