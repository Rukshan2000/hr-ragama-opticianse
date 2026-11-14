"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, FileSignature, FileText, Link2, ListChecks, Loader2, LogOut, Plus, RefreshCcw, ShieldCheck, Trash2, Unlink, Upload, XCircle } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useListState } from "@/hooks/use-list-state";
import { useSession } from "@/hooks/use-session";
import { api, errorMessage, fileUrl } from "@/lib/api/client";
import { formatDate, today } from "@/lib/format";
import { cn } from "@/lib/utils";
import { checklistTemplatesConfig } from "./configs";
import { col, CrudDialog, CrudPage, FileField, FileLink, label, money, opts, Status, Tabs, useOptions, type CrudField, type Row } from "./kit";
import { ApprovalPanel, type Approval } from "./workflow";

const DOC_CATEGORIES = ["identity", "education", "certificate", "contract", "medical", "other"];
const CONTRACT_TYPES = ["permanent", "temporary", "contract", "internship"];

/* ── Documents ── */

function UploadDocumentDialog({ employeeId, onClose }: { employeeId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const fields: CrudField[] = [
    ...(employeeId ? [] : [{ name: "employeeId", label: "Employee", type: "employee" as const, required: true }]),
    { name: "fileId", label: "File", type: "file", required: true, purpose: "document" },
    { name: "title", label: "Title", required: true },
    { name: "category", label: "Category", type: "select", required: true, options: opts(DOC_CATEGORIES), default: "identity" },
    { name: "expiryDate", label: "Expiry date", type: "date" },
    { name: "notes", label: "Notes", type: "textarea" },
  ];
  return (
    <CrudDialog
      title="Upload document"
      description="PDF, image or Office files up to 10 MB. Stored privately; only authorized users can download."
      fields={fields}
      row={null}
      open
      employeeId={employeeId}
      onOpenChange={(o) => !o && onClose()}
      submitLabel="Upload"
      onSubmit={async ({ employeeId: picked, ...b }) => {
        await api.post(`employees/${employeeId ?? picked}/documents`, b);
        toast.success("Document added");
        qc.invalidateQueries({ queryKey: ["documents"] });
      }}
    />
  );
}

export function EmployeeDocuments({ employeeId }: { employeeId: string }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const [upload, setUpload] = useState(false);
  const q = useQuery({ queryKey: ["documents", employeeId], queryFn: () => api.get<Row[]>(`employees/${employeeId}/documents`) });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`documents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <ContentCard title="Documents" description="Identity, education, contracts and other files." actions={<Button size="sm" variant="outline" onClick={() => setUpload(true)}><Upload /> Upload</Button>} bodyClassName="p-0">
      {q.isPending ? (
        <LoadingState className="p-5" rows={2} />
      ) : q.error ? (
        <ErrorState message={q.error.message} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={FileText} title="No documents yet" />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {q.data.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-5 py-3">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <FileLink id={String(d.fileId)} name={String(d.title)} fileName={d.fileName as string} />
                <p className="text-xs text-muted-foreground">
                  {label(d.category as string)} · {String(d.fileName)}
                  {d.expiryDate ? <> · expires {formatDate(d.expiryDate as string)}</> : null}
                </p>
              </div>
              {can("documents:manage") && (
                <Button variant="ghost" size="icon-sm" aria-label="Delete document" onClick={() => remove.mutate(d.id)}>
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {upload && <UploadDocumentDialog employeeId={employeeId} onClose={() => setUpload(false)} />}
    </ContentCard>
  );
}

export function DocumentsPage() {
  const { can } = useSession();
  const list = useListState({ sort: "createdAt", order: "desc" });
  const [category, setCategoryRaw] = useState<string | null>(null);
  const [expiring, setExpiringRaw] = useState(false);
  const [upload, setUpload] = useState(false);
  const setCategory = (v: string | null) => (setCategoryRaw(v), list.setPage(1));
  const setExpiring = (v: boolean) => (setExpiringRaw(v), list.setPage(1));
  const params = { page: list.page, limit: list.limit, search: list.params.search, category: category ?? undefined, expiringWithinDays: expiring ? 60 : undefined };
  const q = useQuery({
    queryKey: ["documents", "all", params],
    queryFn: () => api.list<Row>("documents", params),
    placeholderData: (p) => p,
  });
  return (
    <PageContainer>
      <PageHeader title="Employee documents" description="Every employee file in one place. Downloads are authorized per request; nothing is public." actions={can("documents:manage") && <Button onClick={() => setUpload(true)}><Upload /> Upload document</Button>} />
      <DataTable
        columns={[
          { key: "title", header: "Document", cell: (r) => <FileLink id={r.fileId as string} name={r.title as string} fileName={r.fileName as string} /> },
          col.employee(),
          { key: "cat", header: "Category", cell: (r) => label(r.category as string) },
          col.date("expiryDate", "Expires"),
          col.date("createdAt", "Uploaded"),
        ]}
        rows={q.data?.items}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error?.message}
        footer={<Pagination meta={q.data?.meta} onPageChange={list.setPage} onLimitChange={list.setLimit} />}
        toolbar={
          <>
            <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search title or employee" />
            <div className="w-40"><SelectField value={category} onChange={setCategory} options={opts(DOC_CATEGORIES)} noneLabel="All categories" /></div>
            <Button variant={expiring ? "default" : "outline"} size="sm" onClick={() => setExpiring(!expiring)}>Expiring in 60 days</Button>
          </>
        }
        empty={<EmptyState icon={FileText} title="No documents" />}
      />
      {upload && <UploadDocumentDialog onClose={() => setUpload(false)} />}
    </PageContainer>
  );
}

/* ── Contracts ── */

const contractFields = (withEmployee: boolean): CrudField[] => [
  ...(withEmployee ? [{ name: "employeeId", label: "Employee", type: "employee" as const, required: true }] : []),
  { name: "contractNumber", label: "Contract number", type: "code", required: true },
  { name: "contractType", label: "Type", type: "select", required: true, options: opts(CONTRACT_TYPES), default: "permanent" },
  { name: "startDate", label: "Start", type: "date", required: true },
  { name: "endDate", label: "End", type: "date", hint: "Required for fixed-term contracts" },
  { name: "probationEndDate", label: "Probation ends", type: "date" },
  { name: "fileId", label: "Signed contract", type: "file", purpose: "contract" },
  { name: "notes", label: "Notes", type: "textarea" },
];

function ContractAction({ row, action, onClose }: { row: Row; action: "renew" | "terminate" | "confirm"; onClose: () => void }) {
  const qc = useQueryClient();
  const fields: CrudField[] =
    action === "renew"
      ? [
          { name: "contractNumber", label: "New contract number", type: "code", required: true },
          { name: "startDate", label: "Starts", type: "date", required: true },
          { name: "endDate", label: "Ends", type: "date" },
          { name: "fileId", label: "Signed renewal", type: "file", purpose: "contract" },
          { name: "notes", label: "Notes", type: "textarea" },
        ]
      : action === "terminate"
        ? [
            { name: "endDate", label: "End date", type: "date", required: true, default: today() },
            { name: "reason", label: "Reason", type: "textarea" },
          ]
        : [
            { name: "confirmedOn", label: "Confirmed on", type: "date", required: true, default: today() },
            { name: "reason", label: "Note", type: "textarea" },
          ];
  return (
    <CrudDialog
      title={{ renew: "Renew contract", terminate: "Terminate contract", confirm: "Confirm employment" }[action]}
      description={{ renew: "The current contract ends the day before the renewal starts.", terminate: "Ends this contract early.", confirm: "Completes probation: the employee becomes Active and the confirmation is recorded in their history." }[action]}
      fields={fields}
      row={null}
      open
      onOpenChange={(o) => !o && onClose()}
      onSubmit={async (b) => {
        await api.post(`contracts/${row.id}/${action}`, b);
        toast.success("Done");
        qc.invalidateQueries({ queryKey: ["contracts"] });
        qc.invalidateQueries({ queryKey: ["employee"] });
      }}
    />
  );
}

export function ContractsList({ employeeId }: { employeeId?: string }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const list = useListState({ sort: "startDate", order: "desc" });
  const [status, setStatus] = useState<string | null>(null);
  const [expiring, setExpiring] = useState(false);
  const [dialog, setDialog] = useState<{ row: Row | null } | null>(null);
  const [action, setAction] = useState<{ row: Row; action: "renew" | "terminate" | "confirm" } | null>(null);
  const params = { ...list.params, status: status ?? undefined, employeeId, expiringWithinDays: expiring ? 60 : undefined };
  const q = useQuery({ queryKey: ["contracts", params], queryFn: () => api.list<Row>("contracts", params), placeholderData: (p) => p });
  const run = useMutation({
    mutationFn: ({ id, op }: { id: string; op: "activate" | "delete" }) => (op === "delete" ? api.delete(`contracts/${id}`) : api.post(`contracts/${id}/activate`)),
    onSuccess: () => {
      toast.success("Contract updated");
      qc.invalidateQueries({ queryKey: ["contracts"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const manage = can("contracts:manage");
  return (
    <div className="space-y-4">
      {manage && (
        <div className="flex justify-end">
          <Button onClick={() => setDialog({ row: null })}><Plus /> New contract</Button>
        </div>
      )}
      <DataTable
        columns={[
          col.code("contractNumber"),
          ...(employeeId ? [] : [col.employee()]),
          { key: "type", header: "Type", cell: (r) => label(r.contractType as string) },
          { key: "period", header: "Period", cell: (r) => <span className="text-[13px] tabular-nums">{formatDate(r.startDate as string)} – {r.endDate ? formatDate(r.endDate as string) : "open-ended"}</span> },
          {
            key: "exp",
            header: "Expires in",
            hideBelow: "md",
            cell: (r) =>
              r.status === "active" && r.daysToExpiry !== null ? (
                <span className={cn("tabular-nums text-[13px]", Number(r.daysToExpiry) <= 30 && "font-medium text-warning")}>{String(r.daysToExpiry)} days</span>
              ) : (
                "—"
              ),
          },
          { key: "doc", header: "Document", hideBelow: "lg", cell: (r) => <FileLink id={r.fileId as string} name={r.fileName as string} fileName={r.fileName as string} /> },
          col.status(),
          {
            key: "a",
            header: "",
            className: "w-12",
            cell: (r) =>
              manage && (
                <div onClick={(e) => e.stopPropagation()}>
                  <ActionDropdown
                    items={[
                      { label: "Activate", icon: CheckCircle2, hidden: r.status !== "draft", onSelect: () => run.mutate({ id: r.id, op: "activate" }) },
                      { label: "Edit", icon: FileSignature, hidden: r.status !== "draft", onSelect: () => setDialog({ row: r }) },
                      { label: "Confirm probation", icon: ShieldCheck, hidden: r.status !== "active" || Boolean(r.confirmedOn) || !["probation", "onboarding"].includes(r.employeeStatus as string), onSelect: () => setAction({ row: r, action: "confirm" }) },
                      { label: "Renew", icon: RefreshCcw, hidden: !["active", "expired"].includes(r.status as string), onSelect: () => setAction({ row: r, action: "renew" }) },
                      { label: "Terminate", icon: XCircle, hidden: r.status !== "active", destructive: true, onSelect: () => setAction({ row: r, action: "terminate" }) },
                      { label: "Delete draft", icon: Trash2, hidden: r.status !== "draft", destructive: true, onSelect: () => run.mutate({ id: r.id, op: "delete" }) },
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
        toolbar={
          !employeeId && (
            <>
              <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search number or employee" />
              <div className="w-36"><SelectField value={status} onChange={setStatus} options={opts(["draft", "active", "expired", "terminated", "renewed"])} noneLabel="All statuses" /></div>
              <Button variant={expiring ? "default" : "outline"} size="sm" onClick={() => setExpiring(!expiring)}>Expiring in 60 days</Button>
            </>
          )
        }
        empty={<EmptyState icon={FileSignature} title="No contracts" />}
        footer={<Pagination meta={q.data?.meta} onPageChange={list.setPage} onLimitChange={list.setLimit} />}
      />
      {dialog && (
        <CrudDialog
          title={dialog.row ? "Edit contract" : "New contract"}
          description="New contracts start as drafts. Activating one updates the employee's employment type."
          fields={contractFields(!employeeId && !dialog.row)}
          row={dialog.row}
          open
          onOpenChange={(o) => !o && setDialog(null)}
          onSubmit={async (b) => {
            if (dialog.row) await api.patch(`contracts/${dialog.row.id}`, b);
            else await api.post("contracts", { ...b, employeeId: employeeId ?? b.employeeId });
            toast.success("Contract saved");
            qc.invalidateQueries({ queryKey: ["contracts"] });
          }}
        />
      )}
      {action && <ContractAction {...action} onClose={() => setAction(null)} />}
    </div>
  );
}

export function ContractsPage() {
  return (
    <PageContainer>
      <PageHeader title="Employment contracts" description="Permanent, temporary, contract and internship agreements with renewals, probation confirmation and expiry reminders." />
      <ContractsList />
    </PageContainer>
  );
}

/* ── Checklists (onboarding / exit) ── */

export function EmployeeTasks({ employeeId, kind }: { employeeId: string; kind?: "onboarding" | "exit" }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["tasks", employeeId, kind], queryFn: () => api.get<Row[]>(`employees/${employeeId}/tasks`, { kind }) });
  const [title, setTitle] = useState("");
  const invalidate = () => qc.invalidateQueries({ queryKey: ["tasks"] });
  const generate = useMutation({ mutationFn: (k: string) => api.post(`employees/${employeeId}/tasks/generate`, { kind: k }), onSuccess: invalidate, onError: (e) => toast.error(errorMessage(e)) });
  const toggle = useMutation({ mutationFn: (t: Row) => api.patch(`tasks/${t.id}`, { done: !t.completedAt }), onSuccess: invalidate });
  const add = useMutation({ mutationFn: () => api.post(`employees/${employeeId}/tasks`, { kind: kind ?? "onboarding", title }), onSuccess: () => { setTitle(""); invalidate(); } });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`tasks/${id}`), onSuccess: invalidate });
  const manage = can("employees:manage");
  const groups = (["onboarding", "exit"] as const).filter((k) => !kind || k === kind);
  return (
    <div className="space-y-5">
      {groups.map((k) => {
        const items = (q.data ?? []).filter((t) => t.kind === k);
        const done = items.filter((t) => t.completedAt).length;
        return (
          <ContentCard
            key={k}
            title={`${label(k)} checklist`}
            description={items.length ? `${done} of ${items.length} done` : "Not started"}
            actions={manage && <Button size="sm" variant="outline" disabled={generate.isPending} onClick={() => generate.mutate(k)}><ListChecks /> {items.length ? "Add missing template tasks" : `Start ${k}`}</Button>}
            bodyClassName="p-0"
          >
            {items.length > 0 && (
              <div className="h-1 bg-subtle"><div className="h-1 bg-success transition-all" style={{ width: `${(done / items.length) * 100}%` }} /></div>
            )}
            <ul className="divide-y divide-border-subtle">
              {items.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                  <button disabled={!manage} aria-label={t.completedAt ? "Mark as not done" : "Mark as done"} onClick={() => toggle.mutate(t)} className="text-muted-foreground hover:text-foreground disabled:cursor-default">
                    {t.completedAt ? <CheckCircle2 className="size-5 text-success" /> : <Circle className="size-5" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-[13px]", Boolean(t.completedAt) && "text-muted-foreground line-through")}>{String(t.title)}</p>
                    <p className="text-xs text-text-muted">
                      {t.completedAt ? `Done by ${t.completedByName ?? "—"}` : t.dueDate ? `Due ${formatDate(t.dueDate as string)}` : ""}
                    </p>
                  </div>
                  {manage && <Button variant="ghost" size="icon-sm" aria-label="Delete task" onClick={() => remove.mutate(t.id)}><Trash2 /></Button>}
                </li>
              ))}
            </ul>
            {manage && kind && (
              <form className="flex gap-2 border-t px-5 py-3" onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate(); }}>
                <Input placeholder="Add a custom task" value={title} onChange={(e) => setTitle(e.target.value)} />
                <Button type="submit" variant="outline" disabled={!title.trim()}><Plus /> Add</Button>
              </form>
            )}
          </ContentCard>
        );
      })}
    </div>
  );
}

export function OnboardingPage() {
  const [tab, setTab] = useState("progress");
  const [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["tasks", "board", "onboarding"], queryFn: () => api.get<Row[]>("tasks/board", { kind: "onboarding" }), enabled: tab === "progress" });
  return (
    <PageContainer>
      <PageHeader title="Onboarding" description="New joiners' checklists: documents, equipment, induction and probation goals. Start a checklist from the employee's profile." />
      <Tabs tabs={[{ value: "progress", label: "In progress" }, { value: "templates", label: "Checklist templates" }]} value={tab} onChange={setTab} />
      {tab === "templates" ? (
        <CrudPage config={checklistTemplatesConfig} embedded />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <div className="rounded-xl border bg-card">
            {q.isPending ? (
              <LoadingState className="p-5" />
            ) : !q.data?.length ? (
              <EmptyState icon={ListChecks} title="No onboarding in progress" description="Open a new employee and choose “Start onboarding” on the Checklists tab." />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {q.data.map((r) => (
                  <li key={String(r.employeeId)}>
                    <button onClick={() => setSelected(String(r.employeeId))} className={cn("flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-subtle/60", selected === r.employeeId && "bg-subtle")}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">{String(r.employeeName)}</p>
                        <p className="text-xs text-muted-foreground">{(r.departmentName as string) ?? "No department"} · joined {formatDate(r.joiningDate as string)}</p>
                      </div>
                      <div className="w-24 text-right">
                        <p className="text-xs tabular-nums text-muted-foreground">{String(r.done)}/{String(r.total)}</p>
                        <div className="mt-1 h-1.5 rounded-full bg-subtle"><div className="h-1.5 rounded-full bg-success" style={{ width: `${(Number(r.done) / Number(r.total)) * 100}%` }} /></div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {selected ? <EmployeeTasks employeeId={selected} kind="onboarding" /> : <div className="hidden rounded-xl border border-dashed lg:block"><EmptyState icon={ListChecks} title="Select a new joiner" /></div>}
        </div>
      )}
    </PageContainer>
  );
}

/* ── Exit management ── */

type ExitCase = Row & { clearances: Row[]; openAssets: Row[]; approval: Approval | null };

function ExitDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["exit", id], queryFn: () => api.get<ExitCase>(`exit-cases/${id}`) });
  const [form, setForm] = useState<Record<string, string>>({});
  const invalidate = () => qc.invalidateQueries({ queryKey: ["exit"] });
  const patch = useMutation({ mutationFn: (b: object) => api.patch(`exit-cases/${id}`, b), onSuccess: () => { toast.success("Saved"); invalidate(); }, onError: (e) => toast.error(errorMessage(e)) });
  const clear = useMutation({ mutationFn: (c: Row) => api.patch(`exit-cases/${id}/clearances/${c.id}`, { isCleared: !c.isCleared }), onSuccess: invalidate, onError: (e) => toast.error(errorMessage(e)) });
  const complete = useMutation({ mutationFn: () => api.post(`exit-cases/${id}/complete`), onSuccess: () => { toast.success("Exit completed"); invalidate(); qc.invalidateQueries({ queryKey: ["employees"] }); }, onError: (e) => toast.error(errorMessage(e)) });
  const x = q.data;
  const manage = can("exit:manage");
  const v = (k: string) => form[k] ?? (x?.[k] === null || x?.[k] === undefined ? "" : String(x[k]));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{x ? `${label(x.exitType as string)}: ${x.employeeName}` : "Exit case"}</DialogTitle>
          {x && <DialogDescription>Notice given {formatDate(x.noticeDate as string)} · last working day {formatDate(x.lastWorkingDay as string)}</DialogDescription>}
        </DialogHeader>
        {!x ? (
          <LoadingState rows={4} />
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-2"><Status value={x.status as string} />{x.reason ? <span className="text-[13px] text-muted-foreground">“{String(x.reason)}”</span> : null}</div>
            {x.approval && x.status === "pending" && <ApprovalPanel approval={x.approval} onDone={invalidate} />}
            {x.clearances.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-[13px] font-semibold">Clearance</h3>
                {x.openAssets.length > 0 && <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">Holding {x.openAssets.length} asset(s): {x.openAssets.map((a) => a.assetTag).join(", ")}. Record returns under Assets.</p>}
                <ul className="grid gap-2 sm:grid-cols-2">
                  {x.clearances.map((c) => (
                    <li key={c.id}>
                      <button disabled={!manage || x.status !== "approved"} onClick={() => clear.mutate(c)} className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] hover:bg-subtle disabled:cursor-default">
                        {c.isCleared ? <CheckCircle2 className="size-4 text-success" /> : <Circle className="size-4 text-muted-foreground" />}
                        <span className="flex-1">{String(c.area)}</span>
                        {c.isCleared ? <span className="text-xs text-text-muted">{String(c.clearedByName ?? "")}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {manage && ["pending", "approved"].includes(x.status as string) && (
              <section className="grid gap-3 sm:grid-cols-2">
                <h3 className="text-[13px] font-semibold sm:col-span-2">Exit interview & final settlement</h3>
                <FormField label="Last working day">{(p) => <Input {...p} type="date" value={v("lastWorkingDay")} onChange={(e) => setForm({ ...form, lastWorkingDay: e.target.value })} />}</FormField>
                <FormField label="Interview date">{(p) => <Input {...p} type="date" value={v("interviewDate")} onChange={(e) => setForm({ ...form, interviewDate: e.target.value })} />}</FormField>
                <FormField label="Interview notes" className="sm:col-span-2">{(p) => <Textarea {...p} rows={3} value={v("interviewNotes")} onChange={(e) => setForm({ ...form, interviewNotes: e.target.value })} />}</FormField>
                <FormField label="Settlement earnings" hint="Leave encashment, gratuity, final salary">{(p) => <Input {...p} type="number" step="0.01" value={v("settlementEarnings")} onChange={(e) => setForm({ ...form, settlementEarnings: e.target.value })} />}</FormField>
                <FormField label="Settlement deductions" hint="Loans, unreturned assets">{(p) => <Input {...p} type="number" step="0.01" value={v("settlementDeductions")} onChange={(e) => setForm({ ...form, settlementDeductions: e.target.value })} />}</FormField>
                <FormField label="Paid on">{(p) => <Input {...p} type="date" value={v("settlementPaidOn")} onChange={(e) => setForm({ ...form, settlementPaidOn: e.target.value })} />}</FormField>
                <div className="flex items-end text-[13px]">Net settlement: <span className="ml-1 font-semibold tabular-nums">{money(x.settlementNet)}</span></div>
                <div className="flex justify-end gap-2 sm:col-span-2">
                  <Button
                    variant="outline"
                    disabled={patch.isPending || Object.keys(form).length === 0}
                    onClick={() =>
                      patch.mutate(
                        Object.fromEntries(Object.entries(form).map(([k, val]) => [k, val === "" ? null : k.startsWith("settlementE") || k.startsWith("settlementD") ? Number(val) : val])),
                      )
                    }
                  >
                    Save details
                  </Button>
                  {x.status === "approved" && (
                    <Button disabled={complete.isPending} onClick={() => complete.mutate()}>
                      <LogOut /> Complete exit
                    </Button>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ExitPage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const [status, setStatus] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(() => (typeof window !== "undefined" ? new URLSearchParams(location.search).get("case") : null));
  const [create, setCreate] = useState(false);
  const q = useQuery({ queryKey: ["exit", "list", status, search], queryFn: () => api.get<Row[]>("exit-cases", { status: status ?? undefined, search: search.trim() || undefined }) });
  return (
    <PageContainer>
      <PageHeader title="Exit management" description="Resignations and terminations: approval, notice period, clearance, exit interview and final settlement." actions={can("exit:manage") && <Button onClick={() => setCreate(true)}><Plus /> Record exit</Button>} />
      <DataTable
        columns={[
          col.employee(),
          { key: "t", header: "Type", cell: (r) => label(r.exitType as string) },
          col.date("noticeDate", "Notice"),
          col.date("lastWorkingDay", "Last day"),
          col.money("settlementNet", "Settlement"),
          col.status(),
        ]}
        rows={q.data}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error?.message}
        onRowClick={(r) => setOpen(r.id)}
        toolbar={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Search employee" />
            <div className="w-40"><SelectField value={status} onChange={setStatus} options={opts(["pending", "approved", "completed", "rejected", "cancelled"])} noneLabel="All statuses" /></div>
          </>
        }
        empty={<EmptyState icon={LogOut} title="No exit cases" />}
      />
      {open && <ExitDetail id={open} onClose={() => setOpen(null)} />}
      {create && (
        <CrudDialog
          title="Record resignation or termination"
          description="Goes through the exit approval workflow. On approval the employee moves to On notice and clearance starts."
          fields={[
            { name: "employeeId", label: "Employee", type: "employee", required: true },
            { name: "exitType", label: "Type", type: "select", required: true, options: opts(["resignation", "termination"]), default: "resignation" },
            { name: "noticeDate", label: "Notice date", type: "date", required: true, default: today() },
            { name: "noticeDays", label: "Notice period (days)", type: "number", required: true, min: 0, max: 365, default: "30" },
            { name: "lastWorkingDay", label: "Last working day", type: "date", hint: "Defaults to notice date + notice period" },
            { name: "reason", label: "Reason", type: "textarea" },
          ]}
          row={null}
          open
          onOpenChange={setCreate}
          onSubmit={async (b) => {
            await api.post("exit-cases", b);
            toast.success("Exit recorded");
            qc.invalidateQueries({ queryKey: ["exit"] });
          }}
        />
      )}
    </PageContainer>
  );
}

/* ── Employee profile extras ── */

export function EmployeeAccount({ employeeId }: { employeeId: string }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const linked = useQuery({ queryKey: ["employee", employeeId, "account"], queryFn: () => api.get<{ id: string; name: string; email: string } | null>(`employees/${employeeId}/account`) });
  const users = useOptions("users", (r) => `${r.name} (${r.email})`, {}, can("users:read"));
  const [userId, setUserId] = useState<string | null>(null);
  const set = useMutation({
    mutationFn: (id: string | null) => api.put(`employees/${employeeId}/account`, { userId: id }),
    onSuccess: () => {
      toast.success("Account updated");
      setUserId(null);
      qc.invalidateQueries({ queryKey: ["employee"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <ContentCard title="Login account" description="Employees can exist without an account. Linking one enables self-service (leave, attendance, payslips).">
      {linked.isPending ? (
        <LoadingState rows={1} />
      ) : linked.data ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px]">
            <Link2 className="mr-1.5 inline size-4 text-success" />
            {linked.data.name} <span className="text-muted-foreground">({linked.data.email})</span>
          </p>
          {can("employees:manage") && <Button variant="outline" size="sm" onClick={() => set.mutate(null)}><Unlink /> Unlink</Button>}
        </div>
      ) : can("employees:manage") && can("users:read") ? (
        <div className="flex gap-2">
          <div className="flex-1"><SelectField value={userId} onChange={setUserId} options={users} placeholder="Choose a user of this organization" /></div>
          <Button disabled={!userId || set.isPending} onClick={() => set.mutate(userId)}>{set.isPending && <Loader2 className="animate-spin" />} Link</Button>
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">No account linked.</p>
      )}
    </ContentCard>
  );
}

export function PhotoUpload({ employeeId, photoFileId }: { employeeId: string; photoFileId: string | null }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<{ id: string; name: string } | null>(null);
  const save = useMutation({
    mutationFn: (fileId: string | null) => api.put(`employees/${employeeId}/photo`, { fileId }),
    onSuccess: () => {
      toast.success("Photo updated");
      setFile(null);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="flex items-center gap-3">
      {photoFileId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fileUrl(photoFileId, true)} alt="" className="size-14 rounded-xl border object-cover" />
      ) : (
        <span className="grid size-14 place-items-center rounded-xl border bg-subtle text-xs text-text-muted">No photo</span>
      )}
      <div className="w-64">
        <FileField value={file} onChange={(f) => { setFile(f); if (f) save.mutate(f.id); }} purpose="photo" employeeId={employeeId} accept=".png,.jpg,.jpeg,.webp" />
      </div>
      {photoFileId && <Button variant="ghost" size="sm" onClick={() => save.mutate(null)}>Remove</Button>}
    </div>
  );
}

