"use client";

import { useQuery } from "@tanstack/react-query";
import { Contact, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { UserAvatar } from "@/components/shared/badges";
import { DataTable, FilterDropdown, Pagination, SearchInput, type Column } from "@/components/shared/data-table";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { useListState } from "@/hooks/use-list-state";
import { useSession } from "@/hooks/use-session";
import { employeesApi } from "@/lib/api/endpoints";
import type { Employee, EmployeeStatus, EmploymentType } from "@/lib/api/types";
import { formatDate } from "@/lib/format";
import { EmployeeFormDialog } from "./employee-form-dialog";
import { EMPLOYMENT_TYPES, EmployeeStatusBadge, STATUS, options, useLookups } from "./shared";

const ALL = "all";

export function EmployeesPage() {
  const { can } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const list = useListState({ sort: "name", order: "asc" });
  const [status, setStatus] = useState<EmployeeStatus | typeof ALL>(ALL);
  const [type, setType] = useState<EmploymentType | typeof ALL>(ALL);
  const [department, setDepartment] = useState<string>(params.get("departmentId") ?? ALL);
  const [creating, setCreating] = useState(false);
  const lookups = useLookups();

  const filters = {
    ...list.params,
    status: status === ALL ? undefined : status,
    employmentType: type === ALL ? undefined : type,
    departmentId: department === ALL ? undefined : department,
  };
  const employees = useQuery({ queryKey: ["employees", "list", filters], queryFn: () => employeesApi.list(filters), placeholderData: (p) => p });
  const filtered = Boolean(list.params.search) || status !== ALL || type !== ALL || department !== ALL;
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    list.setPage(1);
  };

  const columns: Column<Employee>[] = [
    {
      key: "name",
      header: "Employee",
      sortKey: "name",
      cell: (e) => (
        <div className="flex items-center gap-3">
          <UserAvatar name={e.fullName} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium">{e.displayName || e.fullName}</p>
            <p className="truncate text-xs text-muted-foreground">{e.email ?? "No email"}</p>
          </div>
        </div>
      ),
    },
    { key: "number", header: "No.", sortKey: "employeeNumber", cell: (e) => <span className="font-mono text-xs text-muted-foreground">{e.employeeNumber}</span> },
    {
      key: "role",
      header: "Department / title",
      hideBelow: "md",
      cell: (e) => (
        <div className="min-w-0">
          <p className="truncate">{e.department?.name ?? "—"}</p>
          <p className="truncate text-xs text-muted-foreground">{e.designation?.name ?? "No designation"}</p>
        </div>
      ),
    },
    { key: "manager", header: "Manager", hideBelow: "lg", cell: (e) => <span className="text-muted-foreground">{e.manager?.name ?? "—"}</span> },
    { key: "status", header: "Status", cell: (e) => <EmployeeStatusBadge status={e.status} /> },
    { key: "joined", header: "Joined", sortKey: "joiningDate", hideBelow: "sm", cell: (e) => <span className="text-muted-foreground tabular-nums">{formatDate(e.joiningDate)}</span> },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Employees"
        description="Employee records, independent of login accounts."
        actions={
          can("employees:create") && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Add employee
            </Button>
          )
        }
      />
      <DataTable
        columns={columns}
        rows={employees.data?.items}
        rowKey={(e) => e.id}
        loading={employees.isPending}
        error={employees.error?.message}
        onRetry={() => employees.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={(e) => router.push(`/employees/${e.id}`)}
        toolbar={
          <>
            <SearchInput value={list.search} onChange={list.setSearch} placeholder="Name, number or email" />
            <div className="flex flex-wrap gap-2">
              <FilterDropdown label="Status" value={status} onChange={reset(setStatus)} options={[{ value: ALL, label: "All statuses" }, ...options(STATUS)]} />
              <FilterDropdown label="Department" value={department} onChange={reset(setDepartment)} options={[{ value: ALL, label: "All departments" }, ...lookups.departments]} />
              <FilterDropdown label="Employment type" value={type} onChange={reset(setType)} options={[{ value: ALL, label: "All types" }, ...options(EMPLOYMENT_TYPES)]} />
            </div>
          </>
        }
        empty={
          <EmptyState
            icon={Contact}
            title={filtered ? "No employees match your filters" : "No employees yet"}
            description={filtered ? "Try a different search or filter." : "Add your first employee to start building your workforce records."}
          />
        }
        footer={<Pagination meta={employees.data?.meta} onPageChange={list.setPage} onLimitChange={list.setLimit} />}
      />
      <EmployeeFormDialog open={creating} onOpenChange={setCreating} />
    </PageContainer>
  );
}
