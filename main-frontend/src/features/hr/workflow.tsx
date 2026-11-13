"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CheckCheck, GitBranch, Inbox, Loader2, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/shared/form";
import { ContentCard, PageContainer, PageHeader } from "@/components/shared/page";
import { SelectField } from "@/components/shared/select-field";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FormAlert } from "@/features/auth/auth-card";
import { useSession } from "@/hooks/use-session";
import { api, errorMessage } from "@/lib/api/client";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { label, Status, Tabs, useOptions } from "./kit";

export interface Approval {
  id: string;
  entityType: string;
  entityLabel: string;
  link: string | null;
  title: string;
  requester: { id: string; name: string | null } | null;
  subjectEmployee: { id: string; name: string | null } | null;
  steps: { order: number; type: string }[];
  currentStep: number;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  canDecide: boolean;
  actions?: { id: string; stepOrder: number; decision: string; comment: string | null; createdAt: string; actorName: string | null; onBehalfOfName: string | null }[];
}

/** Approval trail + decision form. Used by the inbox and by module detail views. */
export function ApprovalPanel({ approval, onDone }: { approval: Approval; onDone?: () => void }) {
  const qc = useQueryClient();
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: (decision: "approved" | "rejected") => api.post(`approvals/${approval.id}/decision`, { decision, comment: comment || null }),
    onSuccess: (_, d) => {
      toast.success(d === "approved" ? "Approved" : "Rejected");
      setComment("");
      qc.invalidateQueries();
      onDone?.();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <div className="space-y-4">
      <ol className="space-y-3 border-l border-border-subtle pl-4">
        {(approval.actions ?? []).map((a) => (
          <li key={a.id} className="relative text-[13px]">
            <span className={cn("absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-card", a.decision === "approved" ? "bg-success" : a.decision === "rejected" ? "bg-danger" : "bg-info")} />
            <p>
              <span className="font-medium">{a.actorName ?? "System"}</span> {a.decision === "submitted" ? "submitted the request" : a.decision}
              {a.stepOrder > 0 && approval.steps.length > 1 && <span className="text-muted-foreground"> · step {a.stepOrder}</span>}
              {a.onBehalfOfName && <span className="text-muted-foreground"> · on behalf of {a.onBehalfOfName}</span>}
            </p>
            {a.comment && <p className="mt-0.5 text-muted-foreground">“{a.comment}”</p>}
            <p className="text-xs text-text-muted">{formatDateTime(a.createdAt)}</p>
          </li>
        ))}
        {approval.status === "pending" && (
          <li className="relative text-[13px] text-muted-foreground">
            <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-card bg-warning" />
            Waiting for step {approval.currentStep} of {approval.steps.length} ({label(approval.steps.find((s) => s.order === approval.currentStep)?.type)} approval)
          </li>
        )}
      </ol>
      {approval.canDecide && (
        <div className="space-y-3 rounded-lg border bg-subtle/50 p-3">
          {error && <FormAlert>{error}</FormAlert>}
          <FormField label="Comment" hint="Required when rejecting">
            {(p) => <Textarea {...p} rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />}
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="text-danger" disabled={decide.isPending} onClick={() => (comment.trim() ? decide.mutate("rejected") : setError("Add a reason to reject"))}>
              <X /> Reject
            </Button>
            <Button disabled={decide.isPending} onClick={() => decide.mutate("approved")}>
              {decide.isPending ? <Loader2 className="animate-spin" /> : <Check />} Approve
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ApprovalDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["approvals", id], queryFn: () => api.get<Approval>(`approvals/${id}`) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{q.data?.title ?? "Approval"}</DialogTitle>
          <DialogDescription>
            {q.data && (
              <>
                {q.data.entityLabel} · requested by {q.data.requester?.name ?? "—"} on {formatDate(q.data.createdAt)}
                {q.data.link && (
                  <>
                    {" · "}
                    <Link href={q.data.link} className="underline">
                      Open record
                    </Link>
                  </>
                )}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {q.isPending ? <LoadingState rows={3} /> : q.error ? <ErrorState message={q.error.message} /> : <ApprovalPanel approval={q.data} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

export function ApprovalsPage() {
  const [box, setBox] = useState<"assigned" | "mine" | "all">("assigned");
  const [status, setStatus] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["approvals", box, status], queryFn: () => api.get<Approval[]>("approvals", { box, status: status ?? undefined }) });
  return (
    <PageContainer>
      <PageHeader title="Approvals" description="Leave, attendance corrections, expense claims, resignations and profile changes waiting on you." />
      <Tabs
        tabs={[
          { value: "assigned", label: "Waiting for me" },
          { value: "mine", label: "My requests" },
          { value: "all", label: "All (HR)" },
        ]}
        value={box}
        onChange={(b) => {
          setBox(b);
          setStatus(null);
        }}
      />
      {box !== "assigned" && (
        <div className="w-48">
          <SelectField value={status} onChange={setStatus} noneLabel="Any status" options={["pending", "approved", "rejected", "cancelled"].map((v) => ({ value: v, label: label(v) }))} />
        </div>
      )}
      <div className="rounded-xl border bg-card">
        {q.isPending ? (
          <LoadingState className="p-5" />
        ) : q.error ? (
          <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
        ) : q.data.length === 0 ? (
          <EmptyState icon={Inbox} title={box === "assigned" ? "You're all caught up" : "No requests"} description={box === "assigned" ? "New requests that need your decision appear here." : undefined} />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {q.data.map((a) => (
              <li key={a.id}>
                <button onClick={() => setOpen(a.id)} className="flex w-full flex-col gap-1 px-5 py-3.5 text-left hover:bg-subtle/60 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{a.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.entityLabel} · {a.requester?.name ?? "—"} · {formatDateTime(a.createdAt)}
                      {a.steps.length > 1 && ` · step ${a.currentStep}/${a.steps.length}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {a.canDecide && <span className="rounded-md bg-brand-accent/10 px-2 py-0.5 text-xs font-medium text-brand-accent">Your decision</span>}
                    <Status value={a.status} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {open && <ApprovalDialog id={open} onClose={() => setOpen(null)} />}
    </PageContainer>
  );
}

/* ── Notifications bell ── */

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function NotificationsBell() {
  const { inTenant } = useSession();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<{ items: Notification[]; unread: number }>("notifications", { limit: 20 }),
    enabled: inTenant,
    refetchInterval: 60_000,
  });
  const read = useMutation({ mutationFn: (id: string) => api.post(`notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const readAll = useMutation({ mutationFn: () => api.post("notifications/read-all"), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  if (!inTenant) return null;
  const unread = q.data?.unread ?? 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative" />}>
        <Bell />
        {unread > 0 && <span className="absolute top-1.5 right-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{unread > 9 ? "9+" : unread}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 rounded-xl p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-[13px] font-semibold">Notifications</span>
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={() => readAll.mutate()}>
              <CheckCheck /> Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {!q.data?.items.length ? (
            <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">No notifications yet</p>
          ) : (
            q.data.items.map((n) => (
              <Link
                key={n.id}
                href={n.link ?? "#"}
                onClick={() => !n.readAt && read.mutate(n.id)}
                className={cn("block border-b border-border-subtle px-3 py-2.5 last:border-0 hover:bg-subtle", !n.readAt && "bg-brand-accent/5")}
              >
                <p className={cn("text-[13px]", !n.readAt && "font-medium")}>{n.title}</p>
                {n.body && <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
                <p className="mt-0.5 text-[11px] text-text-muted">{formatDateTime(n.createdAt)}</p>
              </Link>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── Workflow configuration ── */

interface WorkflowDef {
  entityType: string;
  label: string;
  configured: boolean;
  name: string;
  isActive: boolean;
  steps: { order: number; type: "manager" | "role" | "user"; roleId?: string; roleName?: string; userId?: string; userName?: string }[];
}
type StepDraft = { type: "manager" | "role" | "user"; roleId?: string | null; userId?: string | null };

function WorkflowEditor({ def, onClose }: { def: WorkflowDef; onClose: () => void }) {
  const qc = useQueryClient();
  const roles = useOptions("roles", (r) => String(r.name));
  const users = useOptions("users", (r) => `${r.name} (${r.email})`);
  const [name, setName] = useState(def.name);
  const [active, setActive] = useState(def.isActive);
  const [steps, setSteps] = useState<StepDraft[]>(def.steps.map((s) => ({ type: s.type, roleId: s.roleId, userId: s.userId })));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.put(`workflows/${def.entityType}`, { name, isActive: active, steps: steps.map((s) => (s.type === "manager" ? { type: "manager" } : s.type === "role" ? { type: "role", roleId: s.roleId } : { type: "user", userId: s.userId })) }),
    onSuccess: () => {
      toast.success("Workflow saved");
      qc.invalidateQueries({ queryKey: ["workflows"] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{def.label} approval</DialogTitle>
          <DialogDescription>Steps run in order. A manager step with no manager falls back to anyone holding the module&apos;s approve permission. Changes apply to new requests.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error && <FormAlert>{error}</FormAlert>}
          <FormField label="Name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</FormField>
          <div className="flex items-center gap-2 text-[13px]">
            <Switch checked={active} onCheckedChange={setActive} /> Active (inactive = single manager step)
          </div>
          <ol className="space-y-2">
            {steps.map((s, i) => (
              <li key={i} className="flex items-center gap-2 rounded-lg border p-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-md bg-subtle text-xs font-semibold">{i + 1}</span>
                <div className="w-32">
                  <SelectField value={s.type} onChange={(t) => setSteps(steps.map((x, j) => (j === i ? { type: (t ?? "manager") as StepDraft["type"] } : x)))} options={[{ value: "manager", label: "Manager" }, { value: "role", label: "Role" }, { value: "user", label: "Specific user" }]} />
                </div>
                <div className="min-w-0 flex-1">
                  {s.type === "role" && <SelectField value={s.roleId ?? null} onChange={(v) => setSteps(steps.map((x, j) => (j === i ? { ...x, roleId: v } : x)))} options={roles} placeholder="Choose role" />}
                  {s.type === "user" && <SelectField value={s.userId ?? null} onChange={(v) => setSteps(steps.map((x, j) => (j === i ? { ...x, userId: v } : x)))} options={users} placeholder="Choose user" />}
                  {s.type === "manager" && <span className="text-[13px] text-muted-foreground">Requester&apos;s reporting manager</span>}
                </div>
                <Button variant="ghost" size="icon-sm" aria-label="Remove step" disabled={steps.length === 1} onClick={() => setSteps(steps.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ol>
          {steps.length < 5 && (
            <Button variant="outline" size="sm" onClick={() => setSteps([...steps, { type: "role" }])}>
              <Plus /> Add step
            </Button>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || steps.some((s) => (s.type === "role" && !s.roleId) || (s.type === "user" && !s.userId))} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="animate-spin" />} Save workflow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface Delegation {
  id: string;
  startDate: string;
  endDate: string;
  fromName: string;
  toName: string;
}

export function DelegationsCard() {
  const qc = useQueryClient();
  const users = useOptions("users", (r) => `${r.name} (${r.email})`);
  const q = useQuery({ queryKey: ["delegations"], queryFn: () => api.get<Delegation[]>("delegations") });
  const [d, setD] = useState({ toUserId: null as string | null, startDate: "", endDate: "" });
  const add = useMutation({
    mutationFn: () => api.post("delegations", d),
    onSuccess: () => {
      toast.success("Delegation created");
      setD({ toUserId: null, startDate: "", endDate: "" });
      qc.invalidateQueries({ queryKey: ["delegations"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`delegations/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["delegations"] }) });
  return (
    <ContentCard title="Delegation" description="While you are away, let a colleague decide approvals assigned to you.">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <FormField label="Delegate to">{(p) => <SelectField {...p} value={d.toUserId} onChange={(v) => setD({ ...d, toUserId: v })} options={users} />}</FormField>
        <FormField label="From">{(p) => <Input {...p} type="date" value={d.startDate} onChange={(e) => setD({ ...d, startDate: e.target.value })} />}</FormField>
        <FormField label="Until">{(p) => <Input {...p} type="date" value={d.endDate} onChange={(e) => setD({ ...d, endDate: e.target.value })} />}</FormField>
        <Button disabled={!d.toUserId || !d.startDate || !d.endDate || add.isPending} onClick={() => add.mutate()}>
          Add
        </Button>
      </div>
      <ul className="mt-4 divide-y divide-border-subtle text-[13px]">
        {(q.data ?? []).map((x) => (
          <li key={x.id} className="flex items-center justify-between py-2">
            <span>
              {x.fromName} → <span className="font-medium">{x.toName}</span> · {formatDate(x.startDate)} – {formatDate(x.endDate)}
            </span>
            <Button variant="ghost" size="icon-sm" aria-label="Remove delegation" onClick={() => remove.mutate(x.id)}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
    </ContentCard>
  );
}

export function WorkflowsPage() {
  const q = useQuery({ queryKey: ["workflows"], queryFn: () => api.get<WorkflowDef[]>("workflows") });
  const [editing, setEditing] = useState<WorkflowDef | null>(null);
  return (
    <PageContainer>
      <PageHeader title="Workflows" description="One approval engine for every module: sequential steps by manager, role or specific user." />
      {q.isPending ? (
        <LoadingState />
      ) : q.error ? (
        <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {q.data.map((w) => (
            <ContentCard
              key={w.entityType}
              title={
                <span className="flex items-center gap-2">
                  <GitBranch className="size-4 text-muted-foreground" /> {w.label}
                </span>
              }
              description={w.configured ? w.name : "Default: reporting manager"}
              actions={
                <Button variant="outline" size="sm" onClick={() => setEditing(w)}>
                  Configure
                </Button>
              }
            >
              <ol className="flex flex-wrap items-center gap-1.5 text-[13px]">
                {w.steps.map((s, i) => (
                  <li key={i} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-text-muted">→</span>}
                    <span className="rounded-md border bg-subtle px-2 py-0.5">{s.type === "manager" ? "Manager" : s.type === "role" ? s.roleName : s.userName}</span>
                  </li>
                ))}
                {!w.isActive && <Status value="cancelled" />}
              </ol>
            </ContentCard>
          ))}
        </div>
      )}
      <DelegationsCard />
      {editing && <WorkflowEditor def={editing} onClose={() => setEditing(null)} />}
    </PageContainer>
  );
}
