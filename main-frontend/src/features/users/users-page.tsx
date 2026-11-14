"use client";

import { Eye, Plus, Trash2, UserCheck, UserX, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionDropdown } from "@/components/shared/action-dropdown";
import { ActiveBadge, StatusBadge, UserAvatar } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, FilterDropdown, Pagination, SearchInput, type Column } from "@/components/shared/data-table";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { useListState } from "@/hooks/use-list-state";
import { useSession } from "@/hooks/use-session";
import type { User } from "@/lib/api/types";
import { formatDate, formatDateTime } from "@/lib/format";
import { CreateUserDialog } from "./user-form-dialog";
import { UserSheet } from "./user-sheet";
import { useUserMutations, useUsers } from "./use-users";

type StatusFilter = "all" | "active" | "inactive";

export function UsersPage() {
  const { me, can } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const list = useListState({ sort: "createdAt", order: "desc" }, params.get("search") ?? "");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [creating, setCreating] = useState(params.get("new") === "1" && can("users:create"));
  const [viewing, setViewing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<User | null>(null);
  const { setStatus: setUserStatus, remove } = useUserMutations();

  // Header search navigates here with ?search=; adopt it, then clean the URL.
  const { setSearch } = list;
  const urlSearch = params.get("search");
  useEffect(() => {
    if (urlSearch !== null) {
      setSearch(urlSearch);
      router.replace("/users");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSearch]);

  const users = useUsers({ ...list.params, isActive: status === "all" ? undefined : status === "active" });

  const columns: Column<User>[] = [
    {
      key: "user",
      header: "User",
      sortKey: "name",
      cell: (u) => (
        <div className="flex items-center gap-3">
          <UserAvatar name={u.name} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium">
              {u.name} {u.id === me?.id && <span className="text-xs font-normal text-text-muted">(you)</span>}
            </p>
            <p className="truncate text-xs text-muted-foreground">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: "roles",
      header: "Roles",
      hideBelow: "md",
      cell: (u) =>
        u.roles.length ? (
          <div className="flex flex-wrap gap-1">
            {u.roles.map((r) => (
              <StatusBadge key={r.id} dot={false}>
                {r.name}
              </StatusBadge>
            ))}
          </div>
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
    { key: "status", header: "Status", cell: (u) => <ActiveBadge active={u.isActive} /> },
    { key: "lastLogin", header: "Last sign-in", hideBelow: "lg", cell: (u) => <span className="text-muted-foreground">{formatDateTime(u.lastLoginAt)}</span> },
    { key: "joined", header: "Joined", sortKey: "createdAt", hideBelow: "sm", cell: (u) => <span className="text-muted-foreground">{formatDate(u.joinedAt)}</span> },
    {
      key: "actions",
      header: "",
      className: "w-12 text-right",
      cell: (u) => {
        const self = u.id === me?.id;
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <ActionDropdown
              items={[
                { label: "View details", icon: Eye, onSelect: () => setViewing(u.id) },
                {
                  label: u.isActive ? "Deactivate" : "Activate",
                  icon: u.isActive ? UserX : UserCheck,
                  hidden: self || !can("users:update"),
                  onSelect: () => setUserStatus.mutate({ id: u.id, isActive: !u.isActive }),
                },
                { label: "Remove", icon: Trash2, destructive: true, hidden: self || !can("users:delete"), onSelect: () => setRemoving(u) },
              ]}
            />
          </div>
        );
      },
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Users"
        description="People with access to this organization."
        actions={
          can("users:create") && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Add user
            </Button>
          )
        }
      />
      <DataTable
        columns={columns}
        rows={users.data?.items}
        rowKey={(u) => u.id}
        loading={users.isPending}
        error={users.error?.message}
        onRetry={() => users.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={(u) => setViewing(u.id)}
        toolbar={
          <>
            <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search name or email" />
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
        empty={
          <EmptyState
            icon={Users}
            title={list.params.search || status !== "all" ? "No users match your filters" : "No users yet"}
            description={list.params.search || status !== "all" ? "Try a different search or status." : "Add your first teammate to get started."}
          />
        }
        footer={<Pagination meta={users.data?.meta} onPageChange={list.setPage} onLimitChange={list.setLimit} />}
      />
      <CreateUserDialog open={creating} onOpenChange={setCreating} />
      <UserSheet userId={viewing} onOpenChange={(o) => !o && setViewing(null)} />
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name}?`}
        description="They will lose access to this organization immediately. Their account is not deleted."
        confirmLabel="Remove user"
        destructive
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id, { onSuccess: () => setRemoving(null) })}
      />
    </PageContainer>
  );
}
