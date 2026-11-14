"use client";

import { Briefcase, Building2, Layers, MapPin } from "lucide-react";
import type { Column } from "@/components/shared/data-table";
import { organizationApi } from "@/lib/api/endpoints";
import type { Branch, Department, OrgLevel } from "@/lib/api/types";
import type { MasterConfig } from "./master-data-page";

const code = <T extends { code: string }>(): Column<T> => ({
  key: "code",
  header: "Code",
  sortKey: "code",
  className: "w-32",
  cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.code}</span>,
});
const nameCol = <T extends { name: string; description?: string | null }>(header = "Name"): Column<T> => ({
  key: "name",
  header,
  sortKey: "name",
  cell: (r) => (
    <div className="min-w-0">
      <p className="truncate font-medium">{r.name}</p>
      {r.description && <p className="truncate text-xs text-muted-foreground">{r.description}</p>}
    </div>
  ),
});
const deptFields = (nameLabel: string) => [
  { name: "code", label: "Code", type: "code" as const, required: true, autoGenerate: true },
  { name: "name", label: nameLabel, required: true },
  { name: "description", label: "Description", type: "textarea" as const },
];
const inUse = "This can’t be undone. If employees or chart units still reference it, deletion is blocked — deactivate it instead.";

export const branchesConfig: MasterConfig<Branch & Record<string, unknown>> = {
  queryKey: "branches",
  title: "Branches",
  singular: "Branch",
  description: "Physical locations. Each branch has its own time zone for attendance and scheduling.",
  icon: MapPin,
  api: organizationApi.branches as MasterConfig<Branch & Record<string, unknown>>["api"],
  hasActive: true,
  defaultSort: { sort: "name", order: "asc" },
  deleteHint: inUse,
  fields: [
    { name: "code", label: "Code", type: "code", required: true, autoGenerate: true },
    { name: "name", label: "Name", required: true },
    { name: "timezone", label: "Time zone", type: "timezone", required: true },
    { name: "phone", label: "Phone" },
    { name: "email", label: "Email", type: "email" },
    { name: "address", label: "Address", type: "textarea" },
  ],
  columns: [
    code(),
    {
      key: "name",
      header: "Branch",
      sortKey: "name",
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.name}</p>
          {r.address && <p className="truncate text-xs text-muted-foreground">{r.address}</p>}
        </div>
      ),
    },
    { key: "tz", header: "Time zone", hideBelow: "md", cell: (r) => <span className="text-muted-foreground">{r.timezone}</span> },
    { key: "contact", header: "Contact", hideBelow: "lg", cell: (r) => <span className="text-muted-foreground">{r.phone ?? r.email ?? "—"}</span> },
  ],
};

export const departmentsConfig: MasterConfig<Department & Record<string, unknown>> = {
  queryKey: "departments",
  title: "Departments",
  singular: "Department",
  description: "Functional departments employees are assigned to.",
  icon: Building2,
  api: organizationApi.departments as MasterConfig<Department & Record<string, unknown>>["api"],
  hasActive: true,
  defaultSort: { sort: "name", order: "asc" },
  deleteHint: inUse,
  fields: deptFields("Name"),
  columns: [code(), nameCol("Department")],
};

export const designationsConfig: MasterConfig<Department & Record<string, unknown>> = {
  queryKey: "designations",
  title: "Designations",
  singular: "Designation",
  description: "Job titles used for employee assignments and promotions.",
  icon: Briefcase,
  api: organizationApi.designations as MasterConfig<Department & Record<string, unknown>>["api"],
  hasActive: true,
  defaultSort: { sort: "name", order: "asc" },
  deleteHint: inUse,
  fields: deptFields("Job title"),
  columns: [code(), nameCol("Job title")],
};

export const levelsConfig: MasterConfig<OrgLevel & Record<string, unknown>> = {
  queryKey: "levels",
  title: "Organization Levels",
  singular: "Level",
  description: "Tiers of the organization chart. Rank 1 is the top; a unit always sits at a deeper level than its parent.",
  icon: Layers,
  api: organizationApi.levels as MasterConfig<OrgLevel & Record<string, unknown>>["api"],
  hasActive: false,
  defaultSort: { sort: "rank", order: "asc" },
  deleteHint: "Levels used by chart units can’t be deleted.",
  fields: [
    { name: "name", label: "Name", required: true },
    { name: "rank", label: "Rank", type: "number", required: true, hint: "1 = top of the hierarchy" },
    { name: "description", label: "Description", type: "textarea" },
  ],
  columns: [
    {
      key: "rank",
      header: "Rank",
      sortKey: "rank",
      className: "w-24",
      cell: (r) => <span className="grid size-7 place-items-center rounded-md border bg-subtle text-xs font-semibold tabular-nums">{r.rank}</span>,
    },
    nameCol("Level"),
  ],
};
