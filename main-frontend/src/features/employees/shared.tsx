"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { StatusBadge } from "@/components/shared/badges";
import { Input } from "@/components/ui/input";
import { useDebounced } from "@/hooks/use-debounced";
import { employeesApi, organizationApi } from "@/lib/api/endpoints";
import type { EmployeeStatus, EmploymentType, Gender } from "@/lib/api/types";
import { cn } from "@/lib/utils";

export const STATUS: Record<EmployeeStatus, { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  onboarding: { label: "Onboarding", tone: "info" },
  probation: { label: "Probation", tone: "warning" },
  active: { label: "Active", tone: "success" },
  on_notice: { label: "On notice", tone: "warning" },
  inactive: { label: "Inactive", tone: "neutral" },
  resigned: { label: "Resigned", tone: "danger" },
  terminated: { label: "Terminated", tone: "danger" },
};

/** Mirrors the backend transition table; the backend remains the authority. */
export const TRANSITIONS: Record<EmployeeStatus, EmployeeStatus[]> = {
  onboarding: ["probation", "active", "inactive"],
  probation: ["active", "on_notice", "inactive", "terminated"],
  active: ["on_notice", "inactive", "resigned", "terminated"],
  on_notice: ["active", "resigned", "terminated"],
  inactive: ["active"],
  resigned: [],
  terminated: [],
};

export const EMPLOYMENT_TYPES: Record<EmploymentType, string> = {
  permanent: "Permanent",
  temporary: "Temporary",
  contract: "Contract",
  internship: "Internship",
};

export const GENDERS: Record<Gender, string> = { male: "Male", female: "Female", other: "Other", undisclosed: "Prefer not to say" };

export const options = <K extends string>(m: Record<K, string | { label: string }>) =>
  (Object.entries(m) as [K, string | { label: string }][]).map(([value, l]) => ({ value, label: typeof l === "string" ? l : l.label }));

export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  return <StatusBadge tone={STATUS[status].tone}>{STATUS[status].label}</StatusBadge>;
}

/** Active master data for pickers (backend caps a page at 100). */
export function useLookups(enabled = true) {
  const q = { limit: 100, sort: "name", order: "asc" as const, isActive: true };
  const departments = useQuery({ queryKey: ["departments", "all"], queryFn: () => organizationApi.departments.list(q), enabled });
  const designations = useQuery({ queryKey: ["designations", "all"], queryFn: () => organizationApi.designations.list(q), enabled });
  const branches = useQuery({ queryKey: ["branches", "all"], queryFn: () => organizationApi.branches.list(q), enabled });
  const toOpts = (items?: { id: string; name: string }[]) => (items ?? []).map((i) => ({ value: i.id, label: i.name }));
  return {
    departments: toOpts(departments.data?.items),
    designations: toOpts(designations.data?.items),
    branches: toOpts(branches.data?.items),
  };
}

/** Server-searched employee picker (tenants can have thousands, so no preloaded list). */
export function EmployeePicker({
  value,
  onChange,
  excludeId,
  ...aria
}: {
  value: { id: string; name: string | null } | null;
  onChange: (v: { id: string; name: string } | null) => void;
  excludeId?: string;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const search = useDebounced(term.trim());
  const results = useQuery({
    queryKey: ["employees", "picker", search],
    queryFn: () => employeesApi.list({ search: search || undefined, limit: 8, sort: "name", order: "asc" }),
    enabled: open,
  });
  const items = (results.data?.items ?? []).filter((e) => e.id !== excludeId && !["resigned", "terminated"].includes(e.status));

  if (value && !open) {
    return (
      <div className="flex h-10 items-center justify-between rounded-lg border bg-card px-3 text-sm">
        <span className="truncate">{value.name}</span>
        <button type="button" aria-label="Clear manager" onClick={() => onChange(null)} className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input
        {...aria}
        value={term}
        placeholder="Search by name or number"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setTerm(e.target.value)}
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
      />
      {open && (
        <ul role="listbox" className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-xl border bg-popover p-1 shadow-md">
          {results.isPending ? (
            <li className="px-2 py-1.5 text-[13px] text-muted-foreground">Searching…</li>
          ) : items.length === 0 ? (
            <li className="px-2 py-1.5 text-[13px] text-muted-foreground">No matching employees</li>
          ) : (
            items.map((e) => (
              <li key={e.id} role="option" aria-selected={value?.id === e.id}>
                <button
                  type="button"
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => {
                    onChange({ id: e.id, name: e.fullName });
                    setTerm("");
                    setOpen(false);
                  }}
                  className={cn("flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-subtle")}
                >
                  <span className="truncate">
                    {e.fullName} <span className="font-mono text-xs text-muted-foreground">{e.employeeNumber}</span>
                  </span>
                  {value?.id === e.id && <Check className="size-4" />}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
