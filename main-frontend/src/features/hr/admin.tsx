"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, BarChart3, Banknote, FileSpreadsheet, History, Laptop, Loader2, PackageCheck, Plus, Receipt, ShieldCheck, Undo2, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ActionDropdown } from "@/components/shared/action-dropdown";
import { DataTable, Pagination, SearchInput } from "@/components/shared/data-table";
import { FormField } from "@/components/shared/form";
import { ContentCard, PageContainer, PageHeader } from "@/components/shared/page";
import { SelectField } from "@/components/shared/select-field";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useLookups } from "@/features/employees/shared";
import { useListState } from "@/hooks/use-list-state";
import { useSession } from "@/hooks/use-session";
import { api, apiUrl, errorMessage } from "@/lib/api/client";
import { formatDate, formatDateTime, today } from "@/lib/format";
import { announcementsConfig, ASSET_CONDITIONS, assetCategoriesConfig, assetFields, expenseCategoriesConfig } from "./configs";
import { col, CrudDialog, CrudPage, FileLink, label, money, MONTHS, opts, Status, Tabs, type CrudConfig, type Row } from "./kit";
import { ApprovalPanel, type Approval } from "./workflow";

/* ── Assets ── */

const assetsConfig = (onAssign: (r: Row) => void, onReturn: (r: Row) => void): CrudConfig => ({
  queryKey: "assets",
  title: "Assets",
  singular: "Asset",
  description: "Company equipment, who holds it, and its condition.",
  icon: Laptop,
  path: "assets",
  managePermission: "assets:manage",
  defaultSort: { sort: "assetTag", order: "asc" },
  filters: [
    { key: "status", label: "Status", options: opts(["available", "assigned", "maintenance", "retired"]) },
    { key: "condition", label: "Condition", options: opts(ASSET_CONDITIONS) },
  ],
  fields: [...assetFields, { name: "status", label: "Status", type: "select", options: opts(["available", "maintenance", "retired"]), hint: "Use Assign / Return for assignments" }],
  toBody: (b, editing) => {
    if (!editing) delete b.status;
    else if (!b.status) delete b.status;
    return b;
  },
  columns: [
    col.code("assetTag"),
    col.main("name", "Asset", "categoryName", "name"),
    { key: "holder", header: "Assigned to", cell: (r) => (r.holderName ? <div><p className="text-[13px]">{String(r.holderName)}</p><p className="text-xs text-muted-foreground">since {formatDate(r.assignedOn as string)}</p></div> : <span className="text-text-muted">—</span>) },
    { key: "cond", header: "Condition", hideBelow: "md", cell: (r) => label(r.condition as string) },
    col.money("purchaseCost", "Cost"),
    col.status(),
  ],
  rowActions: (r) => [
    { label: "Assign", icon: UserPlus, hidden: r.status !== "available", onSelect: () => onAssign(r) },
    { label: "Record return", icon: Undo2, hidden: r.status !== "assigned", onSelect: () => onReturn(r) },
  ],
});

export function AssetsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("assets");
  const [assign, setAssign] = useState<Row | null>(null);
  const [ret, setRet] = useState<Row | null>(null);
  const history = useQuery({ queryKey: ["assets", "history"], queryFn: () => api.get<Row[]>("asset-assignments"), enabled: tab === "history" });
  const refresh = () => qc.invalidateQueries({ queryKey: ["assets"] });
  return (
    <PageContainer>
      <PageHeader title="Assets" description="Inventory, assignments, returns and condition history." />
      <Tabs tabs={[{ value: "assets", label: "Inventory" }, { value: "history", label: "Assignment history" }, { value: "categories", label: "Categories" }]} value={tab} onChange={setTab} />
      {tab === "assets" && <CrudPage config={assetsConfig(setAssign, setRet)} embedded />}
      {tab === "categories" && <CrudPage config={assetCategoriesConfig} embedded />}
      {tab === "history" && (
        <DataTable
          columns={[col.code("assetTag"), col.text("assetName", "Asset"), col.employee("employeeName"), col.date("assignedOn", "Assigned"), col.date("returnedOn", "Returned"), { key: "c", header: "Condition out → in", cell: (r) => `${label(r.conditionOut as string)} → ${r.conditionIn ? label(r.conditionIn as string) : "—"}` }]}
          rows={history.data}
          rowKey={(r) => r.id}
          loading={history.isPending}
          error={history.error?.message}
          empty={<EmptyState icon={History} title="No assignments yet" />}
        />
      )}
      {assign && (
        <CrudDialog
          title={`Assign ${assign.name} (${assign.assetTag})`}
          fields={[
            { name: "employeeId", label: "Employee", type: "employee", required: true },
            { name: "assignedOn", label: "Assigned on", type: "date", required: true, default: today() },
            { name: "expectedReturnOn", label: "Expected return", type: "date" },
            { name: "notes", label: "Notes", type: "textarea" },
          ]}
          row={null}
          open
          submitLabel="Assign"
          onOpenChange={(o) => !o && setAssign(null)}
          onSubmit={async (b) => {
            await api.post(`assets/${assign.id}/assign`, b);
            toast.success("Asset assigned");
            refresh();
          }}
        />
      )}
      {ret && (
        <CrudDialog
          title={`Return ${ret.name} from ${ret.holderName}`}
          description="Damaged assets go to maintenance automatically."
          fields={[
            { name: "returnedOn", label: "Returned on", type: "date", required: true, default: today() },
            { name: "conditionIn", label: "Condition", type: "select", required: true, options: opts(ASSET_CONDITIONS), default: String(ret.condition) },
            { name: "notes", label: "Notes", type: "textarea" },
          ]}
          row={null}
          open
          submitLabel="Record return"
          onOpenChange={(o) => !o && setRet(null)}
          onSubmit={async (b) => {
            await api.post(`assets/${ret.id}/return`, b);
            toast.success("Return recorded");
            refresh();
          }}
        />
      )}
    </PageContainer>
  );
}

/* ── Expenses ── */

export function NewClaimDialog({ onClose, onBehalf }: { onClose: () => void; onBehalf?: boolean }) {
  const qc = useQueryClient();
  return (
    <CrudDialog
      title="New expense claim"
      description="Claims go to your manager for approval, then finance for reimbursement."
      fields={[
        ...(onBehalf ? [{ name: "employeeId", label: "Employee", type: "employee" as const, required: true }] : []),
        { name: "categoryId", label: "Category", type: "ref", required: true, ref: { path: "expense-categories", label: (r) => `${r.name}${r.maxAmount ? ` (max ${money(r.maxAmount)})` : ""}`, query: { isActive: true } } },
        { name: "expenseDate", label: "Date", type: "date", required: true, default: today() },
        { name: "amount", label: "Amount", type: "money", required: true, min: 0.01 },
        { name: "description", label: "Description", type: "textarea", required: true },
        { name: "receiptFileId", label: "Receipt", type: "file", purpose: "receipt" },
      ]}
      row={null}
      open
      submitLabel="Submit claim"
      onOpenChange={(o) => !o && onClose()}
      onSubmit={async (b) => {
        await api.post("expense-claims", b);
        toast.success("Claim submitted");
        qc.invalidateQueries({ queryKey: ["expenses"] });
      }}
    />
  );
}

function ClaimDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["expenses", id], queryFn: () => api.get<Row & { approval: Approval | null }>(`expense-claims/${id}`) });
  const c = q.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{c ? `${c.categoryName}: ${money(c.amount)}` : "Expense claim"}</DialogTitle>
          {c && <DialogDescription>{String(c.employeeName)} · {formatDate(c.expenseDate as string)}</DialogDescription>}
        </DialogHeader>
        {!c ? (
          <LoadingState rows={3} />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2"><Status value={c.status as string} />{c.paymentReference ? <span className="text-xs text-muted-foreground">Ref {String(c.paymentReference)}</span> : null}</div>
            <p className="text-[13px]">{String(c.description)}</p>
            <FileLink id={c.receiptFileId as string} name={(c.receiptName as string) ?? "Receipt"} />
            {c.approval && <ApprovalPanel approval={c.approval} onDone={onClose} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ClaimsList({ mine }: { mine?: boolean }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const list = useListState({ sort: "createdAt", order: "desc" });
  const [status, setStatus] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [pay, setPay] = useState<Row | null>(null);
  const params = { ...list.params, status: status ?? undefined, mine: mine ? "true" : undefined };
  const q = useQuery({ queryKey: ["expenses", params], queryFn: () => api.list<Row>("expense-claims", params), placeholderData: (p) => p });
  const cancel = useMutation({ mutationFn: (id: string) => api.post(`expense-claims/${id}/cancel`), onSuccess: () => qc.invalidateQueries({ queryKey: ["expenses"] }), onError: (e) => toast.error(errorMessage(e)) });
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreate(true)}><Plus /> New claim</Button>
      </div>
      <DataTable
        columns={[
          col.date("expenseDate", "Date"),
          ...(mine ? [] : [col.employee()]),
          col.main("categoryName", "Category", "description"),
          col.money("amount", "Amount"),
          { key: "r", header: "Receipt", hideBelow: "md", cell: (r) => <FileLink id={r.receiptFileId as string} name="Receipt" /> },
          col.status(),
          {
            key: "a",
            header: "",
            className: "w-12",
            cell: (r) => (
              <div onClick={(e) => e.stopPropagation()}>
                <ActionDropdown
                  items={[
                    { label: "Record reimbursement", icon: Banknote, hidden: r.status !== "approved" || !can("expenses:manage"), onSelect: () => setPay(r) },
                    { label: "Cancel claim", icon: X, destructive: true, hidden: r.status !== "pending", onSelect: () => cancel.mutate(r.id) },
                  ]}
                />
              </div>
            ),
          },
        ]}
        rows={q.data?.items}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error?.message}
        onRowClick={(r) => setOpen(r.id)}
        toolbar={
          <>
            {!mine && <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search" />}
            <div className="w-40"><SelectField value={status} onChange={setStatus} options={opts(["pending", "approved", "rejected", "reimbursed", "cancelled"])} noneLabel="All statuses" /></div>
          </>
        }
        empty={<EmptyState icon={Receipt} title="No expense claims" />}
        footer={<Pagination meta={q.data?.meta} onPageChange={list.setPage} />}
      />
      {create && <NewClaimDialog onClose={() => setCreate(false)} onBehalf={!mine && can("expenses:manage")} />}
      {open && <ClaimDetail id={open} onClose={() => setOpen(null)} />}
      {pay && (
        <CrudDialog
          title={`Reimburse ${money(pay.amount)} to ${pay.employeeName}`}
          fields={[
            { name: "reimbursedOn", label: "Paid on", type: "date", required: true, default: today() },
            { name: "paymentReference", label: "Payment reference" },
          ]}
          row={null}
          open
          onOpenChange={(o) => !o && setPay(null)}
          onSubmit={async (b) => {
            await api.post(`expense-claims/${pay.id}/reimburse`, b);
            toast.success("Reimbursement recorded");
            qc.invalidateQueries({ queryKey: ["expenses"] });
          }}
        />
      )}
    </div>
  );
}

export function ExpensesPage() {
  const { can } = useSession();
  const [tab, setTab] = useState("claims");
  return (
    <PageContainer>
      <PageHeader title="Expenses" description="Claims with receipts, approval, and reimbursement tracking." />
      <Tabs tabs={[{ value: "claims", label: can("expenses:read") ? "All claims" : "My claims" }, ...(can("expenses:manage") ? [{ value: "categories", label: "Categories" }] : [])]} value={tab} onChange={setTab} />
      {tab === "claims" ? <ClaimsList mine={!can("expenses:read")} /> : <CrudPage config={expenseCategoriesConfig} embedded />}
    </PageContainer>
  );
}

export const AnnouncementsPage = () => <CrudPage config={announcementsConfig} />;

/* ── Reports ── */

interface ReportResult {
  title: string;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
}

export function ReportsPage() {
  const lookups = useLookups();
  const available = useQuery({ queryKey: ["reports"], queryFn: () => api.get<{ type: string; title: string }[]>("reports") });
  const [type, setType] = useState<string | null>(() => (typeof window !== "undefined" ? new URLSearchParams(location.search).get("type") : null));
  const now = new Date();
  const [f, setF] = useState({ from: `${today().slice(0, 7)}-01`, to: today(), branchId: null as string | null, departmentId: null as string | null, year: String(now.getFullYear()), month: String(now.getMonth() + 1) });
  const current = type ?? available.data?.[0]?.type ?? null;
  const dated = !["employees", "assets", "recruitment", "training"].includes(current ?? "");
  const query = { from: dated ? f.from : undefined, to: dated ? f.to : undefined, branchId: f.branchId ?? undefined, departmentId: f.departmentId ?? undefined, ...(current === "payroll" && { year: f.year, month: f.month }) };
  const report = useQuery({ queryKey: ["reports", current, query], queryFn: () => api.get<ReportResult>(`reports/${current}`, query), enabled: Boolean(current) });
  const cell = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "boolean" ? (v ? "Yes" : "No") : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? formatDate(String(v)) : String(v));
  return (
    <PageContainer>
      <PageHeader title="Reports" description="Filter on the server, then export to CSV or Excel. Sensitive reports require their module's permission." />
      {available.data?.length === 0 ? (
        <div className="rounded-xl border bg-card"><EmptyState icon={BarChart3} title="No reports available" description="Ask an administrator for the reports permission." /></div>
      ) : (
        <>
          <Tabs tabs={(available.data ?? []).map((r) => ({ value: r.type, label: r.title }))} value={current ?? ""} onChange={setType} />
          <div className="flex flex-wrap items-end gap-2">
            {current === "payroll" ? (
              <>
                <div className="w-40"><SelectField value={f.month} onChange={(m) => setF({ ...f, month: m ?? "1" })} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} /></div>
                <Input className="w-28" type="number" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} aria-label="Year" />
              </>
            ) : dated && (
              <>
                <Input type="date" aria-label="From" className="w-40" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
                <Input type="date" aria-label="To" className="w-40" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
              </>
            )}
            <div className="w-44"><SelectField value={f.branchId} onChange={(v) => setF({ ...f, branchId: v })} options={lookups.branches} noneLabel="All branches" /></div>
            <div className="w-44"><SelectField value={f.departmentId} onChange={(v) => setF({ ...f, departmentId: v })} options={lookups.departments} noneLabel="All departments" /></div>
            {current && (
              <div className="ml-auto flex gap-2">
                <a href={apiUrl(`reports/${current}`, { ...query, format: "csv" })}><Button variant="outline"><ArrowDownToLine /> CSV</Button></a>
                <a href={apiUrl(`reports/${current}`, { ...query, format: "xls" })}><Button variant="outline"><FileSpreadsheet /> Excel</Button></a>
              </div>
            )}
          </div>
          <div className="overflow-x-auto rounded-xl border bg-card">
            {report.isPending ? (
              <LoadingState className="p-5" />
            ) : report.error ? (
              <ErrorState message={report.error.message} onRetry={() => report.refetch()} />
            ) : report.data.rows.length === 0 ? (
              <EmptyState icon={BarChart3} title="No data for these filters" />
            ) : (
              <table className="w-full text-[13px]">
                <thead className="border-b bg-subtle/50 text-left text-xs text-muted-foreground">
                  <tr>{report.data.columns.map((c) => <th key={c.key} className="px-4 py-2.5 font-medium whitespace-nowrap">{c.label}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {report.data.rows.slice(0, 500).map((r, i) => (
                    <tr key={i}>{report.data.columns.map((c) => <td key={c.key} className="px-4 py-2 whitespace-nowrap tabular-nums">{cell(r[c.key])}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {report.data && report.data.rows.length > 500 && <p className="text-xs text-muted-foreground">Showing 500 of {report.data.rows.length} rows. Export for the full result.</p>}
        </>
      )}
    </PageContainer>
  );
}

/* ── HR settings, audit log, notification preferences ── */

function SettingsForm() {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api.get<{ timezone: string; currency: string; contractReminderDays: number; probationReminderDays: number }>("settings") });
  const [v, setV] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.patch("settings", Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k.endsWith("Days") ? Number(x) : x]))),
    onSuccess: () => {
      toast.success("Settings saved");
      setV({});
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!q.data) return <LoadingState rows={2} />;
  const val = (k: keyof typeof q.data) => v[k] ?? String(q.data[k]);
  const tz = Intl.supportedValuesOf("timeZone").map((t) => ({ value: t, label: t }));
  const disabled = !can("settings:manage");
  return (
    <ContentCard title="Organization HR settings" description="The organization time zone is used for dates when a branch has none.">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Time zone">{(p) => <SelectField {...p} disabled={disabled} value={val("timezone")} onChange={(x) => setV({ ...v, timezone: x ?? "Asia/Colombo" })} options={tz} />}</FormField>
        <FormField label="Currency (ISO code)">{(p) => <Input {...p} disabled={disabled} maxLength={3} value={val("currency")} onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase() })} />}</FormField>
        <FormField label="Contract expiry reminder (days before)">{(p) => <Input {...p} disabled={disabled} type="number" min={1} value={val("contractReminderDays")} onChange={(e) => setV({ ...v, contractReminderDays: e.target.value })} />}</FormField>
        <FormField label="Probation reminder (days before)">{(p) => <Input {...p} disabled={disabled} type="number" min={1} value={val("probationReminderDays")} onChange={(e) => setV({ ...v, probationReminderDays: e.target.value })} />}</FormField>
      </div>
      {!disabled && (
        <div className="mt-4 flex justify-end">
          <Button disabled={!Object.keys(v).length || save.isPending} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="animate-spin" />} Save</Button>
        </div>
      )}
    </ContentCard>
  );
}

export function NotificationPreferences() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notifications", "prefs"], queryFn: () => api.get<{ type: string; inApp: boolean; email: boolean }[]>("notifications/preferences") });
  const save = useMutation({
    mutationFn: (prefs: { type: string; inApp: boolean; email: boolean }[]) => api.put("notifications/preferences", { preferences: prefs }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", "prefs"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <ContentCard title="Notification preferences" description="Choose how you hear about HR events." bodyClassName="p-0">
      {!q.data ? (
        <LoadingState className="p-5" rows={3} />
      ) : (
        <table className="w-full text-[13px]">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr><th className="px-5 py-2 font-medium">Event</th><th className="w-24 px-3 py-2 font-medium">In-app</th><th className="w-24 px-3 py-2 font-medium">Email</th></tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {q.data.map((p) => (
              <tr key={p.type}>
                <td className="px-5 py-2">{label(p.type)}</td>
                <td className="px-3 py-2"><Switch checked={p.inApp} onCheckedChange={(c) => save.mutate(q.data.map((x) => (x.type === p.type ? { ...x, inApp: c } : x)))} aria-label={`${label(p.type)} in-app`} /></td>
                <td className="px-3 py-2"><Switch checked={p.email} onCheckedChange={(c) => save.mutate(q.data.map((x) => (x.type === p.type ? { ...x, email: c } : x)))} aria-label={`${label(p.type)} email`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ContentCard>
  );
}

function AuditLog() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: ["audit", page, search], queryFn: () => api.list<Row>("audit", { page, limit: 25, search: search.trim() || undefined }), placeholderData: (p) => p });
  return (
    <DataTable
      columns={[
        { key: "when", header: "When", cell: (r) => <span className="text-[13px] tabular-nums text-muted-foreground">{formatDateTime(r.createdAt as string)}</span> },
        { key: "who", header: "Actor", cell: (r) => <span className="text-[13px]">{(r.actorName as string) ?? "System"}</span> },
        { key: "act", header: "Action", cell: (r) => <span className="font-mono text-xs">{String(r.action)}</span> },
        { key: "ent", header: "Record", hideBelow: "md", cell: (r) => <span className="text-xs text-muted-foreground">{label(r.entityType as string)}</span> },
        { key: "data", header: "Details", hideBelow: "lg", cell: (r) => <span className="line-clamp-1 max-w-sm font-mono text-[11px] text-muted-foreground">{r.data ? JSON.stringify(r.data) : ""}</span> },
      ]}
      rows={q.data?.items}
      rowKey={(r) => r.id}
      loading={q.isPending}
      error={q.error?.message}
      toolbar={<SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search action or user" />}
      empty={<EmptyState icon={ShieldCheck} title="No audit entries" />}
      footer={<Pagination meta={q.data?.meta} onPageChange={setPage} />}
    />
  );
}

export function HrSettingsPage() {
  const { can } = useSession();
  const [tab, setTab] = useState("general");
  return (
    <PageContainer>
      <PageHeader title="HR settings" description="Organization defaults, statutory payroll configuration, notifications and the audit trail." />
      <Tabs
        tabs={[
          { value: "general", label: "General" },
          { value: "notifications", label: "My notifications" },
          ...(can("audit:read") ? [{ value: "audit", label: "Audit log" }] : []),
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "general" && <SettingsForm />}
      {tab === "notifications" && <NotificationPreferences />}
      {tab === "audit" && <AuditLog />}
    </PageContainer>
  );
}

export function MyAssets() {
  const q = useQuery({ queryKey: ["assets", "mine"], queryFn: () => api.get<Row[]>("asset-assignments", { mine: "true" }) });
  return (
    <DataTable
      columns={[col.code("assetTag"), col.text("assetName", "Asset"), col.date("assignedOn", "Assigned"), col.date("returnedOn", "Returned"), { key: "c", header: "Condition", cell: (r) => label((r.conditionIn ?? r.conditionOut) as string) }]}
      rows={q.data}
      rowKey={(r) => r.id}
      loading={q.isPending}
      error={q.error?.message}
      empty={<EmptyState icon={PackageCheck} title="No assets assigned to you" />}
    />
  );
}

