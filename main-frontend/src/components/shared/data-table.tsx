"use client";

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { PaginationMeta } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { ErrorState } from "./states";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /** Backend sort field, when the column is sortable. */
  sortKey?: string;
  className?: string;
  /** Hide below this breakpoint to keep small screens readable. */
  hideBelow?: "sm" | "md" | "lg";
}

export interface SortState {
  sort: string;
  order: "asc" | "desc";
}

const HIDE = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" };

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  empty,
  sort,
  onSortChange,
  onRowClick,
  toolbar,
  footer,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty: React.ReactNode;
  sort?: SortState;
  onSortChange?: (s: SortState) => void;
  onRowClick?: (row: T) => void;
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const toggle = (key: string) =>
    onSortChange?.({ sort: key, order: sort?.sort === key && sort.order === "asc" ? "desc" : "asc" });

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {toolbar && <div className="flex flex-col gap-2 border-b border-border-subtle p-3 sm:flex-row sm:items-center">{toolbar}</div>}
      {error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-subtle/50">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={sort?.sort === c.sortKey ? (sort?.order === "asc" ? "ascending" : "descending") : undefined}
                    className={cn("h-10 px-4 text-left text-xs font-medium text-muted-foreground", c.hideBelow && HIDE[c.hideBelow], c.className)}
                  >
                    {c.sortKey && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => toggle(c.sortKey!)}
                        className="-mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-subtle hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        {c.header}
                        {sort?.sort === c.sortKey ? (
                          sort.order === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />
                        ) : (
                          <ChevronsUpDown className="size-3.5 opacity-50" />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 6 }, (_, i) => (
                    <tr key={i} className="border-b border-border-subtle last:border-0">
                      {columns.map((c) => (
                        <td key={c.key} className={cn("px-4 py-3.5", c.hideBelow && HIDE[c.hideBelow])}>
                          <Skeleton className="h-4 w-3/4 rounded-md" />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows?.map((row) => (
                    <tr
                      key={rowKey(row)}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      onKeyDown={onRowClick ? (e) => e.key === "Enter" && e.target === e.currentTarget && onRowClick(row) : undefined}
                      tabIndex={onRowClick ? 0 : undefined}
                      className={cn(
                        "border-b border-border-subtle transition-colors last:border-0",
                        onRowClick && "cursor-pointer hover:bg-subtle/60 focus-visible:bg-subtle/60 focus-visible:outline-none",
                      )}
                    >
                      {columns.map((c) => (
                        <td key={c.key} className={cn("px-4 py-3 align-middle", c.hideBelow && HIDE[c.hideBelow], c.className)}>
                          {c.cell(row)}
                        </td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && rows?.length === 0 && empty}
        </div>
      )}
      {footer && !error && <div className="border-t border-border-subtle px-4 py-3">{footer}</div>}
    </div>
  );
}

export function Pagination({ meta, onPageChange }: { meta: PaginationMeta | undefined; onPageChange: (page: number) => void }) {
  if (!meta) return null;
  const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 text-[13px] text-muted-foreground">
      <span className="tabular-nums">
        {from}–{to} of {meta.total}
      </span>
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)}>
          <ChevronLeft />
        </Button>
        <span className="px-2 tabular-nums">
          {meta.page} / {Math.max(meta.totalPages, 1)}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Next page"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPageChange(meta.page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative w-full sm:max-w-xs", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 pr-8 pl-9 [&::-webkit-search-cancel-button]:hidden"
        maxLength={100}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-subtle hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function FilterDropdown<V extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: V;
  onChange: (v: V) => void;
  options: { value: V; label: string }[];
  label: string;
}) {
  return (
    <Select items={options} value={value} onValueChange={(v) => v && onChange(v as V)}>
      <SelectTrigger aria-label={label} className="h-9 min-w-36 data-[size=default]:h-9">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="rounded-xl p-1">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="rounded-lg px-2 py-1.5">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
