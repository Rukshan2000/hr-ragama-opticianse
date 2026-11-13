"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, CheckCircle2, Download, Loader2, Lock, Plus, Receipt, Trash2, Wallet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DataTable, SearchInput } from "@/components/shared/data-table";
import { FormField } from "@/components/shared/form";
import { ContentCard, PageContainer, PageHeader, StatCard } from "@/components/shared/page";
import { SelectField } from "@/components/shared/select-field";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormAlert } from "@/features/auth/auth-card";
import { useLookups } from "@/features/employees/shared";
import { useSession } from "@/hooks/use-session";
import { api, errorMessage } from "@/lib/api/client";
import { formatDate, formatDateTime, today } from "@/lib/format";
import { adjustmentsConfig, loansConfig, payrollPoliciesConfig, salaryComponentsConfig } from "./configs";
import { col, CrudPage, money, MONTHS, Status, Tabs, useOptions, type Row } from "./kit";

const period = (r: { year: unknown; month: unknown }) => `${MONTHS[Number(r.month) - 1]} ${r.year}`;

/* ── Salary structures ── */

function ReviseDialog({ employee, onClose }: { employee: { id: string; name: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const components = useOptions("salary-components", (r) => `${r.name} (${r.kind})`, { isActive: true });
  const history = useQuery({ queryKey: ["salaries", employee.id], queryFn: () => api.get<(Row & { basicSalary: number; items: { componentId: string; name: string; kind: string; amount: number }[] })[]>(`employees/${employee.id}/salaries`) });
  const current = history.data?.[0];
  const [v, setV] = useState<{ effectiveFrom: string; basic: string; reason: string; items: { componentId: string | null; amount: string }[] } | null>(null);
  const form = v ?? { effectiveFrom: today(), basic: current ? String(current.basicSalary) : "", reason: "", items: (current?.items ?? []).map((i) => ({ componentId: i.componentId, amount: String(i.amount) })) };
  const set = (patch: Partial<typeof form>) => setV({ ...form, ...patch });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api.post("salaries", {
        employeeId: employee.id,
        effectiveFrom: form.effectiveFrom,
        basicSalary: Number(form.basic),
        reason: form.reason || null,
        items: form.items.filter((i) => i.componentId && i.amount !== "").map((i) => ({ componentId: i.componentId, amount: Number(i.amount) })),
      }),
    onSuccess: () => {
      toast.success("Salary revised");
      qc.invalidateQueries({ queryKey: ["salaries"] });
      setV(null);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`salaries/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["salaries"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Salary — {employee.name}</DialogTitle>
          <DialogDescription>Revisions are effective-dated; payroll uses the latest revision on or before the period end. Revisions used by finalized payroll cannot be deleted.</DialogDescription>
        </DialogHeader>
        {error && <FormAlert>{error}</FormAlert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Effective from">{(p) => <Input {...p} type="date" value={form.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} />}</FormField>
          <FormField label="Basic salary">{(p) => <Input {...p} type="number" step="0.01" min={0} value={form.basic} onChange={(e) => set({ basic: e.target.value })} />}</FormField>
          <FormField label="Reason">{(p) => <Input {...p} value={form.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="Annual increment" />}</FormField>
        </div>
        <div className="space-y-2">
          <p className="text-[13px] font-medium">Recurring allowances & deductions</p>
          {form.items.map((it, i) => (
            <div key={i} className="flex gap-2">
              <div className="flex-1"><SelectField value={it.componentId} onChange={(c) => set({ items: form.items.map((x, j) => (j === i ? { ...x, componentId: c } : x)) })} options={components} placeholder="Component" /></div>
              <Input className="w-36" type="number" step="0.01" min={0} value={it.amount} onChange={(e) => set({ items: form.items.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })} aria-label="Amount" />
              <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => set({ items: form.items.filter((_, j) => j !== i) })}><Trash2 /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => set({ items: [...form.items, { componentId: null, amount: "" }] })}><Plus /> Add component</Button>
        </div>
        <div className="flex justify-end">
          <Button disabled={!form.basic || !form.effectiveFrom || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="animate-spin" />} Save revision
          </Button>
        </div>
        <div className="border-t pt-4">
          <p className="mb-2 text-[13px] font-semibold">History</p>
          {history.isPending ? (
            <LoadingState rows={2} />
          ) : !history.data?.length ? (
            <p className="text-[13px] text-muted-foreground">No salary on record. This employee is excluded from payroll until one is added.</p>
          ) : (
            <ul className="divide-y divide-border-subtle text-[13px]">
              {history.data.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="font-medium tabular-nums">{money(h.basicSalary)} <span className="font-normal text-muted-foreground">from {formatDate(h.effectiveFrom as string)}</span></p>
                    <p className="text-xs text-muted-foreground">{h.items.map((i) => `${i.name} ${money(i.amount)}`).join(" · ") || "No components"}{h.reason ? ` — ${h.reason}` : ""}</p>
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label="Delete revision" onClick={() => remove.mutate(h.id)}><Trash2 /></Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SalariesPage() {
  const { can } = useSession();
  const lookups = useLookups();
  const [search, setSearch] = useState("");
  const [departmentId, setDept] = useState<string | null>(null);
  const [tab, setTab] = useState("salaries");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const q = useQuery({ queryKey: ["salaries", "current", search, departmentId], queryFn: () => api.get<Row[]>("salaries", { search: search.trim() || undefined, departmentId: departmentId ?? undefined }), enabled: tab === "salaries" });
  return (
    <PageContainer>
      <PageHeader title="Salary structures" description="Basic salary, allowances and deductions per employee, with effective-dated revisions. Confidential: visible to payroll roles only." />
      <Tabs tabs={[{ value: "salaries", label: "Employee salaries" }, { value: "components", label: "Components" }, { value: "loans", label: "Loans & advances" }, { value: "adjustments", label: "Bonuses & adjustments" }]} value={tab} onChange={setTab} />
      {tab === "components" && <CrudPage config={salaryComponentsConfig} embedded />}
      {tab === "loans" && <CrudPage config={loansConfig} embedded />}
      {tab === "adjustments" && <CrudPage config={adjustmentsConfig} embedded />}
      {tab === "salaries" && (
        <DataTable
          columns={[
            col.employee(),
            col.text("departmentName", "Department", { hideBelow: "md" }),
            col.money("basicSalary", "Basic"),
            col.money("allowances", "Allowances"),
            col.date("effectiveFrom", "Since"),
          ]}
          rows={q.data?.map((r) => ({ ...r, id: String(r.employeeId) }) as Row)}
          rowKey={(r) => r.id}
          loading={q.isPending}
          error={q.error?.message}
          onRowClick={can("payroll:manage") ? (r) => setEditing({ id: r.id, name: String(r.employeeName) }) : undefined}
          toolbar={
            <>
              <SearchInput value={search} onChange={setSearch} placeholder="Search employee" />
              <div className="w-44"><SelectField value={departmentId} onChange={setDept} options={lookups.departments} noneLabel="All departments" /></div>
            </>
          }
          empty={<EmptyState icon={Wallet} title="No employees" />}
        />
      )}
      {editing && <ReviseDialog employee={editing} onClose={() => setEditing(null)} />}
    </PageContainer>
  );
}

export function PayrollPoliciesPage() {
  return <CrudPage config={payrollPoliciesConfig} />;
}

/* ── Payroll runs ── */

type Run = Row & { status: string; year: number; month: number; totalGross: number; totalNet: number; totalEmployerCost: number; employeeCount: number; payslips?: Row[] };

function RunDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["payroll-runs", id], queryFn: () => api.get<Run>(`payroll-runs/${id}`) });
  const [confirm, setConfirm] = useState<"approve" | "lock" | "delete" | null>(null);
  const act = useMutation({
    mutationFn: (a: "calculate" | "approve" | "lock" | "delete") => (a === "delete" ? api.delete(`payroll-runs/${id}`) : api.post(`payroll-runs/${id}/${a}`)),
    onSuccess: (_, a) => {
      toast.success({ calculate: "Payroll calculated", approve: "Payroll approved and published to employees", lock: "Payroll locked", delete: "Payroll deleted" }[a]);
      setConfirm(null);
      qc.invalidateQueries({ queryKey: ["payroll-runs"] });
      if (a === "delete") onClose();
    },
    onError: (e) => {
      setConfirm(null);
      toast.error(errorMessage(e));
    },
  });
  const r = q.data;
  const editable = r && ["draft", "calculated"].includes(r.status);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Payroll — {r ? period(r) : ""}</DialogTitle>
          <DialogDescription>
            {r?.status === "draft" && "Not calculated yet."}
            {r?.status === "calculated" && `Calculated ${formatDateTime(r.calculatedAt as string)}. Review, then approve to finalize.`}
            {r && ["approved", "locked"].includes(r.status) && `Finalized by ${r.approvedByName ?? "—"} on ${formatDateTime(r.approvedAt as string)}. Corrections go into a later period as adjustments.`}
          </DialogDescription>
        </DialogHeader>
        {!r ? (
          <LoadingState />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <StatCard label="Employees" value={r.employeeCount} icon={Wallet} />
              <StatCard label="Gross pay" value={money(r.totalGross)} icon={Wallet} />
              <StatCard label="Net pay" value={money(r.totalNet)} icon={Wallet} />
              <StatCard label="Employer cost" value={money(r.totalEmployerCost)} hint="Gross + EPF + ETF" icon={Wallet} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Status value={r.status} />
              <div className="ml-auto flex flex-wrap gap-2">
                <a href={`/api/reports/payroll?format=xls&year=${r.year}&month=${r.month}`}><Button variant="outline" size="sm"><Download /> Excel</Button></a>
                <a href={`/api/reports/payroll?format=csv&year=${r.year}&month=${r.month}`}><Button variant="outline" size="sm"><Download /> CSV</Button></a>
                {editable && can("payroll:manage") && (
                  <>
                    <Button variant="outline" size="sm" className="text-danger" onClick={() => setConfirm("delete")}><Trash2 /> Delete</Button>
                    <Button variant="outline" size="sm" disabled={act.isPending} onClick={() => act.mutate("calculate")}>
                      {act.isPending ? <Loader2 className="animate-spin" /> : <Calculator />} {r.status === "draft" ? "Calculate" : "Recalculate"}
                    </Button>
                  </>
                )}
                {r.status === "calculated" && can("payroll:approve") && <Button size="sm" onClick={() => setConfirm("approve")}><CheckCircle2 /> Approve & finalize</Button>}
                {r.status === "approved" && can("payroll:approve") && <Button size="sm" variant="outline" onClick={() => setConfirm("lock")}><Lock /> Lock</Button>}
              </div>
            </div>
            <DataTable
              columns={[
                col.employee(),
                col.money("basicSalary", "Basic"),
                col.money("overtimePay", "OT"),
                col.money("unpaidLeaveDeduction", "No-pay"),
                col.money("grossPay", "Gross"),
                col.money("epfEmployee", "EPF 8%"),
                col.money("apit", "APIT"),
                col.money("totalDeductions", "Deductions"),
                { key: "net", header: "Net", className: "text-right", cell: (p) => <span className="font-semibold tabular-nums">{money(p.netPay)}</span> },
                { key: "pdf", header: "", className: "w-10", cell: (p) => <a href={`/api/payslips/${p.id}/pdf`} aria-label="Download payslip" onClick={(e) => e.stopPropagation()}><Download className="size-4 text-muted-foreground hover:text-foreground" /></a> },
              ]}
              rows={r.payslips}
              rowKey={(p) => p.id}
              empty={<EmptyState icon={Receipt} title={r.status === "draft" ? "Calculate to generate payslips" : "No employees with a salary for this period"} />}
            />
          </div>
        )}
        <ConfirmDialog
          open={Boolean(confirm)}
          onOpenChange={(o) => !o && setConfirm(null)}
          title={{ approve: "Approve and finalize payroll?", lock: "Lock payroll?", delete: "Delete this payroll?" }[confirm ?? "approve"]}
          description={{
            approve: "Payslips become final and visible to employees, and loan instalments are recovered. A finalized payroll is never recalculated.",
            lock: "Locking closes the period permanently for audit.",
            delete: "The draft and its payslips are removed.",
          }[confirm ?? "approve"]}
          confirmLabel={{ approve: "Approve", lock: "Lock", delete: "Delete" }[confirm ?? "approve"]}
          destructive={confirm === "delete"}
          pending={act.isPending}
          onConfirm={() => confirm && act.mutate(confirm)}
        />
      </DialogContent>
    </Dialog>
  );
}

export function PayrollRunsPage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const now = new Date();
  const [p, setP] = useState({ year: String(now.getFullYear()), month: String(now.getMonth() + 1) });
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["payroll-runs"], queryFn: () => api.get<Run[]>("payroll-runs") });
  const add = useMutation({
    mutationFn: () => api.post<Run>("payroll-runs", { year: Number(p.year), month: Number(p.month) }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["payroll-runs"] });
      setCreate(false);
      setOpen(r.data.id);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <PageContainer>
      <PageHeader
        title="Payroll processing"
        description="Monthly periods: calculate from salaries, attendance, overtime and no-pay leave, then approve to finalize payslips."
        actions={can("payroll:manage") && <Button onClick={() => setCreate(true)}><Plus /> New payroll period</Button>}
      />
      <DataTable
        columns={[
          { key: "p", header: "Period", cell: (r) => <span className="font-medium">{period(r)}</span> },
          col.text("employeeCount", "Employees"),
          col.money("totalGross", "Gross"),
          col.money("totalNet", "Net"),
          col.money("totalEmployerCost", "Employer cost"),
          col.status(),
        ]}
        rows={q.data}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error?.message}
        onRowClick={(r) => setOpen(r.id)}
        empty={<EmptyState icon={Wallet} title="No payroll periods yet" description="Configure statutory policies and salaries, then create a period." />}
      />
      {open && <RunDetail id={open} onClose={() => setOpen(null)} />}
      <Dialog open={create} onOpenChange={setCreate}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New payroll period</DialogTitle>
          </DialogHeader>
          {error && <FormAlert>{error}</FormAlert>}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Month">{(f) => <SelectField {...f} value={p.month} onChange={(m) => setP({ ...p, month: m ?? "1" })} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />}</FormField>
            <FormField label="Year">{(f) => <Input {...f} type="number" value={p.year} onChange={(e) => setP({ ...p, year: e.target.value })} />}</FormField>
          </div>
          <DialogFooter>
            <Button disabled={add.isPending} onClick={() => add.mutate()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

/** Payslip browser: by period for payroll staff. */
export function PayslipsPage() {
  const q = useQuery({ queryKey: ["payroll-runs"], queryFn: () => api.get<Run[]>("payroll-runs") });
  const [runId, setRunId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const selected = runId ?? q.data?.find((r) => ["approved", "locked"].includes(r.status))?.id ?? null;
  const run = useQuery({ queryKey: ["payroll-runs", selected], queryFn: () => api.get<Run>(`payroll-runs/${selected}`), enabled: Boolean(selected) });
  const rows = (run.data?.payslips ?? []).filter((p) => !search.trim() || `${p.employeeName} ${p.employeeNumber}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <PageContainer>
      <PageHeader title="Payslips" description="Download individual payslips as PDF. Employees see their own finalized payslips in My workspace." />
      {q.error ? (
        <ErrorState message={q.error.message} />
      ) : (
        <DataTable
          columns={[
            col.employee(),
            col.text("designationName", "Designation", { hideBelow: "md" }),
            col.money("grossPay", "Gross"),
            col.money("totalDeductions", "Deductions"),
            col.money("netPay", "Net pay"),
            { key: "pdf", header: "", className: "w-28 text-right", cell: (p) => <a href={`/api/payslips/${p.id}/pdf`} className="inline-flex items-center gap-1 text-[13px] text-brand-accent hover:underline"><Download className="size-3.5" /> PDF</a> },
          ]}
          rows={selected ? rows : []}
          rowKey={(r) => r.id}
          loading={q.isPending || run.isFetching}
          toolbar={
            <>
              <div className="w-56"><SelectField value={selected} onChange={setRunId} options={(q.data ?? []).map((r) => ({ value: r.id, label: `${period(r)} (${r.status})` }))} placeholder="Choose period" /></div>
              <SearchInput value={search} onChange={setSearch} placeholder="Search employee" />
            </>
          }
          empty={<EmptyState icon={Receipt} title={selected ? "No payslips in this period" : "No payroll periods"} />}
        />
      )}
    </PageContainer>
  );
}

export function MyPayslips() {
  const q = useQuery({ queryKey: ["payslips", "mine"], queryFn: () => api.get<Row[]>("payslips/mine") });
  return (
    <ContentCard title="Payslips" bodyClassName="p-0">
      {q.isPending ? (
        <LoadingState className="p-5" rows={2} />
      ) : !q.data?.length ? (
        <EmptyState icon={Receipt} title="No payslips yet" description="Payslips appear here once payroll is finalized." />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {q.data.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="text-[13px] font-medium">{period(p as unknown as { year: unknown; month: unknown })}</p>
                <p className="text-xs text-muted-foreground tabular-nums">Gross {money(p.grossPay)} · Deductions {money(p.totalDeductions)}</p>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-semibold tabular-nums">{money(p.netPay)}</span>
                <a href={`/api/payslips/${p.id}/pdf`}><Button variant="outline" size="sm"><Download /> PDF</Button></a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ContentCard>
  );
}
