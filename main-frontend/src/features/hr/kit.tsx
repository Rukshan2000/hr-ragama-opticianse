"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2, Paperclip, Pencil, Plus, Power, Trash2, X, type LucideIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ActionDropdown, type ActionItem } from "@/components/shared/action-dropdown";
import { ActiveBadge, StatusBadge } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable, FilterDropdown, Pagination, SearchInput, type Column } from "@/components/shared/data-table";
import { FormField } from "@/components/shared/form";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { SelectField } from "@/components/shared/select-field";
import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FormAlert } from "@/features/auth/auth-card";
import { EmployeePicker } from "@/features/employees/shared";
import { useListState } from "@/hooks/use-list-state";
import { useSession } from "@/hooks/use-session";
import { api, applyFieldErrors, errorMessage, fileUrl, UPLOAD_ACCEPT, uploadFile } from "@/lib/api/client";
import type { Paginated } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/* ── Formatting ─────────────────────────────────────────────── */

const moneyFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : moneyFmt.format(Number(v)));
export const hours = (minutes: unknown) => (minutes ? `${Math.floor(Number(minutes) / 60)}h ${String(Number(minutes) % 60).padStart(2, "0")}m` : "—");
export const time = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—");
export const label = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replaceAll("_", " ") : "—");
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Tone = "success" | "warning" | "danger" | "info" | "neutral";
const TONE: Record<string, Tone> = {
  approved: "success", active: "success", completed: "success", present: "success", reimbursed: "success", hired: "success", open: "success", available: "success", locked: "info",
  pending: "warning", draft: "neutral", calculated: "info", late: "warning", half_day: "warning", self_review: "warning", manager_review: "info", interview: "info", offered: "info", screening: "info", applied: "neutral", scheduled: "info", ongoing: "info", planned: "neutral", enrolled: "info", assigned: "info", maintenance: "warning", on_leave: "info", holiday: "neutral", off: "neutral",
  rejected: "danger", cancelled: "neutral", absent: "danger", expired: "danger", terminated: "danger", failed: "danger", withdrawn: "neutral", closed: "neutral", filled: "success", retired: "neutral", renewed: "neutral", settled: "success",
};
export function Status({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-text-muted">—</span>;
  return <StatusBadge tone={TONE[value] ?? "neutral"}>{label(value)}</StatusBadge>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: readonly T[] | { value: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  const items = (tabs as (T | { value: T; label: string })[]).map((t) => (typeof t === "string" ? { value: t, label: t } : t));
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border-subtle">
      {items.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            "-mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] font-medium whitespace-nowrap transition-colors",
            value === t.value ? "border-brand-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ── Data hooks ─────────────────────────────────────────────── */

type Q = Record<string, string | number | boolean | undefined>;

/** Options for a reference select, loaded from any list endpoint. */
export function useOptions(path: string, toLabel: (r: Record<string, unknown>) => string, query: Q = {}, enabled = true) {
  const q = useQuery({
    queryKey: [path.split("/")[0], "options", path, query],
    queryFn: () => api.list<Record<string, unknown>>(path, { limit: 500, ...query }),
    enabled,
    staleTime: 30_000,
  });
  return useMemo(() => (q.data?.items ?? []).map((r) => ({ value: String(r.id), label: toLabel(r) })), [q.data, toLabel]);
}

/* ── File upload control ────────────────────────────────────── */

export function FileField({
  value,
  onChange,
  purpose,
  employeeId,
  accept = UPLOAD_ACCEPT,
}: {
  value: { id: string; name: string } | null;
  onChange: (v: { id: string; name: string } | null) => void;
  purpose: string;
  employeeId?: string;
  accept?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const up = await uploadFile(f, purpose, employeeId);
      onChange({ id: up.id, name: up.name });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="flex h-10 items-center gap-2 rounded-lg border bg-card px-2 text-sm">
      <input ref={input} type="file" accept={accept} className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      {value ? (
        <>
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <a href={fileUrl(value.id)} className="min-w-0 flex-1 truncate hover:underline">
            {value.name}
          </a>
          <button type="button" aria-label="Remove file" onClick={() => onChange(null)} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </>
      ) : (
        <Button type="button" variant="ghost" size="sm" className="-ml-1" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="animate-spin" /> : <Paperclip />} {busy ? "Uploading…" : "Choose file (max 10 MB)"}
        </Button>
      )}
    </div>
  );
}

export function FileLink({ id, name }: { id: string | null | undefined; name?: string | null }) {
  if (!id) return <span className="text-text-muted">—</span>;
  return (
    <a href={fileUrl(id)} onClick={(e) => e.stopPropagation()} className="inline-flex max-w-48 items-center gap-1 text-[13px] text-brand-accent hover:underline">
      <Download className="size-3.5 shrink-0" />
      <span className="truncate">{name ?? "Download"}</span>
    </a>
  );
}

/* ── Generic form fields ────────────────────────────────────── */

export interface CrudField {
  name: string;
  label: string;
  type?: "text" | "code" | "email" | "number" | "money" | "textarea" | "date" | "time" | "datetime" | "select" | "boolean" | "color" | "employee" | "ref" | "file";
  required?: boolean;
  hint?: string;
  wide?: boolean;
  options?: { value: string; label: string }[];
  /** For type "ref": list endpoint and how to label rows. */
  ref?: { path: string; label: (r: Record<string, unknown>) => string; query?: Q };
  /** For type "file". */
  purpose?: string;
  default?: unknown;
  createOnly?: boolean;
  min?: number;
  max?: number;
  step?: number;
  /** Row key holding the display name for employee/file fields (e.g. employeeName). */
  display?: string;
}

const toLocalInput = (iso: unknown) => {
  if (!iso) return "";
  const d = new Date(String(iso));
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function fieldSchema(f: CrudField) {
  const req = (s: z.ZodType) => (f.required ? s : s.optional().nullable());
  switch (f.type) {
    case "number":
    case "money": {
      let n = z.coerce.number({ error: "Enter a number" });
      if (f.min !== undefined) n = n.min(f.min, `Must be ${f.min} or more`);
      if (f.max !== undefined) n = n.max(f.max, `Must be ${f.max} or less`);
      return f.required ? n : z.union([z.literal(""), n]).optional().nullable();
    }
    case "boolean":
      return z.boolean();
    case "employee":
    case "file":
      return f.required ? z.object({ id: z.string(), name: z.string().nullable() }, { error: `Choose ${f.label.toLowerCase()}` }) : z.any();
    case "email":
      return f.required ? z.email("Enter a valid email") : z.union([z.literal(""), z.email("Enter a valid email")]).optional().nullable();
    default: {
      const s = z.string().trim().max(f.type === "textarea" ? 20000 : 300);
      return f.required ? s.min(1, `Enter ${f.label.toLowerCase()}`) : req(s);
    }
  }
}

function initialValue(f: CrudField, row: Record<string, unknown> | null) {
  const v = row?.[f.name];
  switch (f.type) {
    case "boolean":
      return row ? Boolean(v) : ((f.default as boolean) ?? false);
    case "employee":
      return row && v ? { id: String(v), name: String(row[f.display ?? "employeeName"] ?? "") } : null;
    case "file":
      return row && v ? { id: String(v), name: String(row[f.display ?? "fileName"] ?? "File") } : null;
    case "datetime":
      return toLocalInput(v);
    case "time":
      return v ? String(v).slice(0, 5) : ((f.default as string) ?? "");
    default:
      return v === null || v === undefined ? (f.default ?? "") : typeof v === "number" ? String(v) : v;
  }
}

function toPayload(fields: CrudField[], values: Record<string, unknown>, editing: boolean) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (editing && f.createOnly) continue;
    const v = values[f.name];
    if (f.type === "employee" || f.type === "file") out[f.name] = (v as { id: string } | null)?.id ?? null;
    else if (f.type === "number" || f.type === "money") out[f.name] = v === "" || v === null || v === undefined ? null : Number(v);
    else if (f.type === "datetime") out[f.name] = v ? new Date(String(v)).toISOString() : null;
    else if (f.type === "boolean") out[f.name] = Boolean(v);
    else out[f.name] = v === "" || v === undefined ? null : v;
  }
  // Optional nulls are omitted on create so server defaults apply.
  if (!editing) for (const k of Object.keys(out)) if (out[k] === null && !fields.find((f) => f.name === k)?.required) delete out[k];
  return out;
}

function RefSelect({ field, value, onChange, aria }: { field: CrudField; value: string | null; onChange: (v: string | null) => void; aria: object }) {
  const opts = useOptions(field.ref!.path, field.ref!.label, field.ref!.query);
  return <SelectField {...aria} value={value} onChange={onChange} options={opts} noneLabel={field.required ? undefined : "None"} />;
}

export function FieldControl({ field: f, control, register, p, employeeId }: { field: CrudField; control: ReturnType<typeof useForm<Record<string, unknown>>>["control"]; register: ReturnType<typeof useForm<Record<string, unknown>>>["register"]; p: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }; employeeId?: string }) {
  const ctl = (render: (v: unknown, set: (x: unknown) => void) => React.ReactNode) => <Controller control={control} name={f.name} render={({ field }) => <>{render(field.value, field.onChange)}</>} />;
  switch (f.type) {
    case "textarea":
      return <Textarea {...p} rows={3} {...register(f.name)} />;
    case "select":
      return ctl((v, set) => <SelectField {...p} value={(v as string) || null} onChange={(x) => set(x ?? "")} options={f.options ?? []} noneLabel={f.required ? undefined : "None"} />);
    case "ref":
      return ctl((v, set) => <RefSelect field={f} aria={p} value={(v as string) || null} onChange={(x) => set(x ?? "")} />);
    case "boolean":
      return ctl((v, set) => (
        <div className="flex h-10 items-center">
          <Switch id={p.id} checked={Boolean(v)} onCheckedChange={(c) => set(c)} />
        </div>
      ));
    case "employee":
      return ctl((v, set) => <EmployeePicker {...p} value={v as { id: string; name: string } | null} onChange={set} />);
    case "file":
      return ctl((v, set) => <FileField value={v as { id: string; name: string } | null} onChange={set} purpose={f.purpose ?? "document"} employeeId={employeeId} />);
    case "color":
      return <Input {...p} type="color" className="h-10 w-20 p-1" {...register(f.name)} />;
    default:
      return (
        <Input
          {...p}
          type={{ number: "number", money: "number", email: "email", date: "date", time: "time", datetime: "datetime-local" }[f.type as string] ?? "text"}
          step={f.step ?? (f.type === "money" ? "0.01" : undefined)}
          min={f.min}
          max={f.max}
          className={f.type === "code" ? "font-mono uppercase" : undefined}
          {...register(f.name)}
        />
      );
  }
}

/* ── Generic create/edit dialog ─────────────────────────────── */

export function CrudDialog({
  title,
  description,
  fields,
  row,
  open,
  onOpenChange,
  onSubmit,
  submitLabel = "Save",
  employeeId,
}: {
  title: string;
  description?: string;
  fields: CrudField[];
  row: Record<string, unknown> | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<unknown>;
  submitLabel?: string;
  employeeId?: string;
}) {
  const visible = fields.filter((f) => !(row && f.createOnly));
  const [error, setError] = useState<string | null>(null);
  const schema = useMemo(() => z.object(Object.fromEntries(visible.map((f) => [f.name, fieldSchema(f)])) as Record<string, z.ZodType>), [visible]);
  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    values: Object.fromEntries(visible.map((f) => [f.name, initialValue(f, row)])),
  });
  const { errors, isSubmitting } = form.formState;
  const close = (o: boolean) => {
    if (!o) setError(null);
    onOpenChange(o);
  };
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await onSubmit(toPayload(visible, values, Boolean(row)));
      close(false);
    } catch (e) {
      if (!applyFieldErrors(e, form.setError)) setError(errorMessage(e));
    }
  });
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form id="crud-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          {error && (
            <div className="sm:col-span-2">
              <FormAlert>{error}</FormAlert>
            </div>
          )}
          {visible.map((f) => (
            <FormField
              key={f.name}
              label={f.required || f.type === "boolean" ? f.label : `${f.label} (optional)`}
              hint={f.hint}
              error={errors[f.name]?.message as string | undefined}
              className={f.wide || f.type === "textarea" || f.type === "employee" || f.type === "file" ? "sm:col-span-2" : undefined}
            >
              {(p) => <FieldControl field={f} control={form.control} register={form.register} p={p} employeeId={employeeId} />}
            </FormField>
          ))}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="submit" form="crud-form" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Generic list page ──────────────────────────────────────── */

export type Row = { id: string } & Record<string, unknown>;

export interface CrudConfig {
  queryKey: string;
  title: string;
  singular: string;
  description: string;
  icon: LucideIcon;
  /** API list path, e.g. "leave-types". */
  path: string;
  managePermission: string;
  fields: CrudField[];
  columns: Column<Row>[];
  filters?: { key: string; label: string; options: { value: string; label: string }[] }[];
  hasActive?: boolean;
  defaultSort: { sort: string; order: "asc" | "desc" };
  deleteHint?: string;
  noDelete?: boolean;
  noEdit?: boolean;
  rowActions?: (row: Row, refresh: () => void) => ActionItem[];
  headerActions?: React.ReactNode;
  query?: Q;
  onRowClick?: (row: Row) => void;
  /** Adapts a row before it fills the form, and the form payload before it is sent. */
  fromRow?: (row: Row) => Row;
  toBody?: (payload: Record<string, unknown>, editing: boolean) => Record<string, unknown>;
}

export function CrudPage({ config, embedded }: { config: CrudConfig; embedded?: boolean }) {
  const { can } = useSession();
  const canManage = can(config.managePermission);
  const qc = useQueryClient();
  const list = useListState(config.defaultSort);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<{ open: boolean; row: Row | null }>({ open: false, row: null });
  const [removing, setRemoving] = useState<Row | null>(null);

  const params: Q = { ...list.params, ...config.query, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== "all")) };
  const query = useQuery({
    queryKey: [config.queryKey, "list", params],
    queryFn: () => api.list<Row>(config.path, params) as Promise<Paginated<Row>>,
    placeholderData: (p) => p,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: [config.queryKey] });
  const toggle = useMutation({
    mutationFn: (r: Row) => api.patch(`${config.path}/${r.id}`, { isActive: !r.isActive }),
    onSuccess: (_, r) => {
      toast.success(`${config.singular} ${r.isActive ? "deactivated" : "activated"}`);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (r: Row) => api.delete(`${config.path}/${r.id}`),
    onSuccess: () => {
      toast.success(`${config.singular} deleted`);
      setRemoving(null);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: Column<Row>[] = [
    ...config.columns,
    ...(config.hasActive ? [{ key: "active", header: "Status", cell: (r: Row) => <ActiveBadge active={Boolean(r.isActive)} /> }] : []),
    {
      key: "actions",
      header: "",
      className: "w-12 text-right",
      cell: (r: Row) => (
        <div onClick={(e) => e.stopPropagation()}>
          <ActionDropdown
            items={[
              ...(config.rowActions?.(r, refresh) ?? []),
              { label: "Edit", icon: Pencil, hidden: !canManage || config.noEdit, onSelect: () => setDialog({ open: true, row: r }) },
              { label: r.isActive ? "Deactivate" : "Activate", icon: Power, hidden: !canManage || !config.hasActive, onSelect: () => toggle.mutate(r) },
              { label: "Delete", icon: Trash2, destructive: true, hidden: !canManage || config.noDelete, onSelect: () => setRemoving(r) },
            ]}
          />
        </div>
      ),
    },
  ];
  const filtered = Boolean(list.params.search) || Object.values(filters).some((v) => v && v !== "all");

  const body = (
    <>
      <DataTable
        columns={columns}
        rows={query.data?.items}
        rowKey={(r) => r.id}
        loading={query.isPending}
        error={query.error?.message}
        onRetry={() => query.refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={config.onRowClick ?? (canManage && !config.noEdit ? (r) => setDialog({ open: true, row: r }) : undefined)}
        toolbar={
          <>
            <SearchInput value={list.search} onChange={list.setSearch} placeholder={`Search ${config.title.toLowerCase()}`} />
            {config.filters?.map((f) => (
              <FilterDropdown
                key={f.key}
                label={f.label}
                value={filters[f.key] ?? "all"}
                onChange={(v) => {
                  setFilters((s) => ({ ...s, [f.key]: v }));
                  list.setPage(1);
                }}
                options={[{ value: "all", label: `All` }, ...f.options]}
              />
            ))}
            {config.hasActive && (
              <FilterDropdown
                label="Status"
                value={filters.isActive ?? "all"}
                onChange={(v) => setFilters((s) => ({ ...s, isActive: v }))}
                options={[
                  { value: "all", label: "All statuses" },
                  { value: "true", label: "Active" },
                  { value: "false", label: "Inactive" },
                ]}
              />
            )}
          </>
        }
        empty={
          <EmptyState
            icon={config.icon}
            title={filtered ? `No ${config.title.toLowerCase()} match your filters` : `No ${config.title.toLowerCase()} yet`}
            description={filtered ? "Try a different search or filter." : canManage ? `Create the first ${config.singular.toLowerCase()}.` : undefined}
          />
        }
        footer={<Pagination meta={query.data?.meta} onPageChange={list.setPage} />}
      />
      <CrudDialog
        title={dialog.row ? `Edit ${config.singular.toLowerCase()}` : `New ${config.singular.toLowerCase()}`}
        description={config.description}
        fields={config.fields}
        row={dialog.row && config.fromRow ? config.fromRow(dialog.row) : dialog.row}
        open={dialog.open}
        onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}
        submitLabel={dialog.row ? "Save changes" : `Create ${config.singular.toLowerCase()}`}
        onSubmit={async (raw) => {
          const b = config.toBody ? config.toBody(raw, Boolean(dialog.row)) : raw;
          if (dialog.row) await api.patch(`${config.path}/${dialog.row.id}`, b);
          else await api.post(config.path, b);
          toast.success(`${config.singular} ${dialog.row ? "updated" : "created"}`);
          refresh();
        }}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Delete ${config.singular.toLowerCase()}?`}
        description={config.deleteHint ?? "This can’t be undone. Records still in use cannot be deleted; deactivate them instead."}
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </>
  );
  const newButton = canManage && (
    <Button onClick={() => setDialog({ open: true, row: null })}>
      <Plus /> New {config.singular.toLowerCase()}
    </Button>
  );
  if (embedded)
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-muted-foreground">{config.description}</p>
          <div className="flex gap-2">
            {config.headerActions}
            {newButton}
          </div>
        </div>
        {body}
      </div>
    );
  return (
    <PageContainer>
      <PageHeader
        title={config.title}
        description={config.description}
        actions={
          <>
            {config.headerActions}
            {newButton}
          </>
        }
      />
      {body}
    </PageContainer>
  );
}

/* ── Small shared columns ───────────────────────────────────── */

export const col = {
  code: (key = "code"): Column<Row> => ({ key, header: "Code", sortKey: key, className: "w-28", cell: (r) => <span className="font-mono text-xs text-muted-foreground">{String(r[key] ?? "")}</span> }),
  text: (key: string, header: string, opts: Partial<Column<Row>> = {}): Column<Row> => ({ key, header, cell: (r) => <span className="text-[13px]">{(r[key] as string) ?? "—"}</span>, ...opts }),
  main: (key: string, header: string, sub?: string, sortKey?: string): Column<Row> => ({
    key,
    header,
    sortKey,
    cell: (r) => (
      <div className="min-w-0">
        <p className="truncate font-medium">{String(r[key] ?? "—")}</p>
        {sub && r[sub] ? <p className="truncate text-xs text-muted-foreground">{String(r[sub])}</p> : null}
      </div>
    ),
  }),
  employee: (name = "employeeName", number = "employeeNumber"): Column<Row> => ({
    key: name,
    header: "Employee",
    cell: (r) => (
      <div className="min-w-0">
        <p className="truncate font-medium">{String(r[name] ?? "—")}</p>
        {r[number] ? <p className="font-mono text-xs text-muted-foreground">{String(r[number])}</p> : null}
      </div>
    ),
  }),
  date: (key: string, header: string, sortKey?: string): Column<Row> => ({
    key,
    header,
    sortKey,
    hideBelow: "md",
    cell: (r) => <span className="text-[13px] text-muted-foreground tabular-nums">{r[key] ? new Date(`${String(r[key]).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { dateStyle: "medium" }) : "—"}</span>,
  }),
  money: (key: string, header: string): Column<Row> => ({ key, header, className: "text-right", cell: (r) => <span className="tabular-nums">{money(r[key])}</span> }),
  status: (key = "status", header = "Status"): Column<Row> => ({ key, header, cell: (r) => <Status value={r[key] as string} /> }),
  bool: (key: string, header: string): Column<Row> => ({ key, header, hideBelow: "md", cell: (r) => <span className="text-[13px] text-muted-foreground">{r[key] ? "Yes" : "No"}</span> }),
  color: (key = "color"): Column<Row> => ({ key, header: "", className: "w-8", cell: (r) => <span className="block size-3 rounded-full border" style={{ background: (r[key] as string) ?? "transparent" }} /> }),
};

export const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: label(v) }));
