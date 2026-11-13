"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRightLeft, Archive, History, Loader2, Pencil, UserCog } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/shared/badges";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FormField } from "@/components/shared/form";
import { ContentCard, PageContainer } from "@/components/shared/page";
import { SelectField } from "@/components/shared/select-field";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormAlert } from "@/features/auth/auth-card";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/api/client";
import { employeesApi } from "@/lib/api/endpoints";
import type { Employee, EmployeeHistory, EmployeeStatus } from "@/lib/api/types";
import { formatDate, formatDateTime, today } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ContractsList, EmployeeAccount, EmployeeDocuments, EmployeeTasks, PhotoUpload } from "@/features/hr/people";
import { LeaveBalances } from "@/features/hr/time";
import { EmployeeFormDialog } from "./employee-form-dialog";
import { EMPLOYMENT_TYPES, EmployeePicker, EmployeeStatusBadge, GENDERS, STATUS, TRANSITIONS, useLookups } from "./shared";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[11px] font-medium tracking-wide text-text-muted uppercase">{label}</dt>
      <dd className="text-[13px] font-medium break-words">{children || <span className="font-normal text-text-muted">—</span>}</dd>
    </div>
  );
}

const Grid = ({ children }: { children: React.ReactNode }) => <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>;

function useInvalidate(id: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["employees"] });
    qc.invalidateQueries({ queryKey: ["employee", id] });
  };
}

function AssignmentDialog({ employee, open, onOpenChange }: { employee: Employee; open: boolean; onOpenChange: (o: boolean) => void }) {
  const lookups = useLookups(open);
  const invalidate = useInvalidate(employee.id);
  const initial = {
    departmentId: employee.department?.id ?? null,
    designationId: employee.designation?.id ?? null,
    branchId: employee.branch?.id ?? null,
    manager: employee.manager ? { id: employee.manager.id, name: employee.manager.name } : null,
  };
  const [v, setV] = useState(initial);
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const changes = {
    ...(v.departmentId !== initial.departmentId && { departmentId: v.departmentId }),
    ...(v.designationId !== initial.designationId && { designationId: v.designationId }),
    ...(v.branchId !== initial.branchId && { branchId: v.branchId }),
    ...((v.manager?.id ?? null) !== (initial.manager?.id ?? null) && { managerId: v.manager?.id ?? null }),
  };
  const save = useMutation({
    mutationFn: () => employeesApi.assignment(employee.id, { ...changes, effectiveDate, reason: reason || null }),
    onSuccess: () => {
      toast.success("Assignment updated");
      invalidate();
      onOpenChange(false);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const reset = (o: boolean) => {
    if (o) {
      setV(initial);
      setEffectiveDate(today());
      setReason("");
      setError(null);
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Transfer or promote</DialogTitle>
          <DialogDescription>Change department, designation, branch or reporting manager. Each change is recorded in the employment history.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {error && (
            <div className="sm:col-span-2">
              <FormAlert>{error}</FormAlert>
            </div>
          )}
          <FormField label="Department">{(p) => <SelectField {...p} value={v.departmentId} onChange={(x) => setV({ ...v, departmentId: x })} options={lookups.departments} noneLabel="Not set" />}</FormField>
          <FormField label="Designation">{(p) => <SelectField {...p} value={v.designationId} onChange={(x) => setV({ ...v, designationId: x })} options={lookups.designations} noneLabel="Not set" />}</FormField>
          <FormField label="Branch">{(p) => <SelectField {...p} value={v.branchId} onChange={(x) => setV({ ...v, branchId: x })} options={lookups.branches} noneLabel="Not set" />}</FormField>
          <FormField label="Reporting manager">{(p) => <EmployeePicker {...p} value={v.manager} excludeId={employee.id} onChange={(m) => setV({ ...v, manager: m })} />}</FormField>
          <FormField label="Effective date">{(p) => <Input {...p} type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />}</FormField>
          <FormField label="Reason (optional)" className="sm:col-span-2">
            {(p) => <Textarea {...p} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => reset(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || Object.keys(changes).length === 0 || !effectiveDate}>
            {save.isPending && <Loader2 className="animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_HELP: Partial<Record<EmployeeStatus, string>> = {
  active: "Confirms the employee; the effective date is stored as the confirmation date.",
  on_notice: "Resignation received; the effective date is stored as the resignation date.",
  resigned: "Final. The employee has left; this cannot be reversed.",
  terminated: "Final. Employment ended by the organization; this cannot be reversed.",
};

function StatusDialog({ employee, open, onOpenChange }: { employee: Employee; open: boolean; onOpenChange: (o: boolean) => void }) {
  const invalidate = useInvalidate(employee.id);
  const next = TRANSITIONS[employee.status];
  const [status, setStatus] = useState<EmployeeStatus | null>(null);
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => employeesApi.status(employee.id, { status: status!, effectiveDate, ...(reason && { reason }) }),
    onSuccess: () => {
      toast.success("Status updated");
      invalidate();
      onOpenChange(false);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const reset = (o: boolean) => {
    if (o) {
      setStatus(null);
      setEffectiveDate(today());
      setReason("");
      setError(null);
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change employment status</DialogTitle>
          <DialogDescription>
            Currently <strong>{STATUS[employee.status].label}</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error && <FormAlert>{error}</FormAlert>}
          <FormField label="New status" hint={status ? STATUS_HELP[status] : undefined}>
            {(p) => <SelectField {...p} value={status} onChange={(s) => setStatus(s as EmployeeStatus | null)} options={next.map((s) => ({ value: s, label: STATUS[s].label }))} />}
          </FormField>
          <FormField label="Effective date">{(p) => <Input {...p} type="date" min={employee.joiningDate} value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />}</FormField>
          <FormField label="Reason (optional)">{(p) => <Textarea {...p} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}</FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => reset(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!status || !effectiveDate || save.isPending}
            className={status && ["resigned", "terminated"].includes(status) ? "bg-danger text-white hover:bg-danger/90" : undefined}
          >
            {save.isPending && <Loader2 className="animate-spin" />}
            Update status
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const FIELD_LABEL: Record<EmployeeHistory["field"], string> = {
  joined: "Joined",
  department: "Department",
  designation: "Designation",
  branch: "Branch",
  manager: "Reporting manager",
  status: "Status",
  employment_type: "Employment type",
};

function historyValue(h: EmployeeHistory, side: "old" | "new") {
  const raw = side === "old" ? h.oldValue : h.newValue;
  const label = side === "old" ? h.oldLabel : h.newLabel;
  if (!raw) return "None";
  if (h.field === "status" || h.field === "joined") return STATUS[raw as EmployeeStatus]?.label ?? raw;
  if (h.field === "employment_type") return EMPLOYMENT_TYPES[raw as keyof typeof EMPLOYMENT_TYPES] ?? raw;
  return label ?? "Deleted record";
}

function HistoryTab({ id }: { id: string }) {
  const history = useQuery({ queryKey: ["employee", id, "history"], queryFn: () => employeesApi.history(id) });
  if (history.isPending) return <LoadingState rows={4} />;
  if (history.error) return <ErrorState message={history.error.message} onRetry={() => history.refetch()} />;
  if (!history.data.length) return <EmptyState icon={History} title="No history yet" />;
  return (
    <ol className="relative space-y-5 border-l border-border-subtle pl-6">
      {history.data.map((h) => (
        <li key={h.id} className="relative">
          <span className="absolute top-1.5 -left-[29px] size-2.5 rounded-full border-2 border-card bg-brand-accent" aria-hidden />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-[13px] font-semibold">{FIELD_LABEL[h.field]}</p>
            <time className="text-xs text-muted-foreground tabular-nums">Effective {formatDate(h.effectiveDate)}</time>
          </div>
          <p className="mt-0.5 text-[13px]">
            {h.field === "joined" ? (
              <>Joined as {historyValue(h, "new")}</>
            ) : (
              <>
                <span className="text-muted-foreground line-through decoration-text-muted/50">{historyValue(h, "old")}</span> → <span className="font-medium">{historyValue(h, "new")}</span>
              </>
            )}
          </p>
          {h.reason && <p className="mt-1 text-xs text-muted-foreground">“{h.reason}”</p>}
          <p className="mt-1 text-[11px] text-text-muted">
            Recorded {formatDateTime(h.createdAt)}
            {h.changedBy?.name && ` by ${h.changedBy.name}`}
          </p>
        </li>
      ))}
    </ol>
  );
}

const TABS = ["Overview", "Personal", "History", "Documents", "Contracts", "Leave", "Checklists", "Account"] as const;

export function EmployeeDetail({ id }: { id: string }) {
  const { can } = useSession();
  const router = useRouter();
  const invalidate = useInvalidate(id);
  const employee = useQuery({ queryKey: ["employee", id], queryFn: () => employeesApi.get(id) });
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [dialog, setDialog] = useState<"edit" | "assign" | "status" | "archive" | null>(null);
  const archive = useMutation({
    mutationFn: () => employeesApi.remove(id),
    onSuccess: () => {
      toast.success("Employee archived");
      invalidate();
      router.push("/employees");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const back = (
    <Link href="/employees" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 text-muted-foreground")}>
      <ArrowLeft /> Employees
    </Link>
  );
  if (employee.isPending) return <PageContainer>{back}<LoadingState rows={6} /></PageContainer>;
  if (employee.error) {
    return (
      <PageContainer>
        {back}
        <div className="rounded-xl border bg-card">
          <ErrorState message={employee.error.message} onRetry={() => employee.refetch()} />
        </div>
      </PageContainer>
    );
  }
  const e = employee.data;
  const final = TRANSITIONS[e.status].length === 0;

  return (
    <PageContainer>
      {back}
      <section className="flex flex-col gap-4 rounded-xl border bg-card p-5 sm:flex-row sm:items-center">
        <UserAvatar name={e.fullName} size="lg" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">{e.displayName || e.fullName}</h1>
            <EmployeeStatusBadge status={e.status} />
          </div>
          <p className="text-[13px] text-muted-foreground">
            <span className="font-mono">{e.employeeNumber}</span>
            {" · "}
            {[e.designation?.name, e.department?.name].filter(Boolean).join(" · ") || "No assignment"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("employees:update") && (
            <Button variant="outline" size="sm" onClick={() => setDialog("edit")}>
              <Pencil /> Edit profile
            </Button>
          )}
          {can("employees:manage") && !final && (
            <>
              <Button variant="outline" size="sm" onClick={() => setDialog("assign")}>
                <ArrowRightLeft /> Transfer / promote
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDialog("status")}>
                <UserCog /> Change status
              </Button>
            </>
          )}
          {can("employees:delete") && (
            <Button variant="outline" size="sm" className="text-danger" onClick={() => setDialog("archive")}>
              <Archive /> Archive
            </Button>
          )}
        </div>
      </section>

      <div role="tablist" aria-label="Employee sections" className="flex gap-1 overflow-x-auto border-b border-border-subtle">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] font-medium whitespace-nowrap transition-colors",
              tab === t ? "border-brand-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "Overview" && (
          <div className="grid gap-6 lg:grid-cols-3">
            <ContentCard title="Employment" className="lg:col-span-2">
              <Grid>
                <Field label="Employment type">{EMPLOYMENT_TYPES[e.employmentType]}</Field>
                <Field label="Department">{e.department?.name}</Field>
                <Field label="Designation">{e.designation?.name}</Field>
                <Field label="Branch">{e.branch?.name}</Field>
                <Field label="Reporting manager">
                  {e.manager && (
                    <Link className="underline-offset-2 hover:underline" href={`/employees/${e.manager.id}`}>
                      {e.manager.name}
                    </Link>
                  )}
                </Field>
                <Field label="Login account">{e.hasAccount ? "Linked" : "None"}</Field>
              </Grid>
            </ContentCard>
            <ContentCard title="Key dates">
              <dl className="space-y-4">
                <Field label="Joined">{formatDate(e.joiningDate)}</Field>
                <Field label="Probation">
                  {e.probationStartDate || e.probationEndDate ? `${formatDate(e.probationStartDate)} – ${formatDate(e.probationEndDate)}` : null}
                </Field>
                <Field label="Confirmed">{e.confirmationDate && formatDate(e.confirmationDate)}</Field>
                {e.resignationDate && <Field label="Resignation">{formatDate(e.resignationDate)}</Field>}
                {e.terminationDate && <Field label="Termination">{formatDate(e.terminationDate)}</Field>}
              </dl>
            </ContentCard>
            {e.notes && (
              <ContentCard title="Notes" className="lg:col-span-3">
                <p className="text-[13px] whitespace-pre-wrap">{e.notes}</p>
              </ContentCard>
            )}
          </div>
        )}
        {tab === "Personal" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <ContentCard title="Personal details">
              <Grid>
                <Field label="First name">{e.firstName}</Field>
                <Field label="Last name">{e.lastName}</Field>
                <Field label="Date of birth">{e.dateOfBirth && formatDate(e.dateOfBirth)}</Field>
                <Field label="Gender">{e.gender && GENDERS[e.gender]}</Field>
              </Grid>
            </ContentCard>
            <ContentCard title="Contact">
              <Grid>
                <Field label="Email">{e.email}</Field>
                <Field label="Phone">{e.phone}</Field>
                <Field label="Address">{e.address}</Field>
              </Grid>
            </ContentCard>
            <ContentCard title="Emergency contact" className="lg:col-span-2">
              <Grid>
                <Field label="Name">{e.emergencyContact.name}</Field>
                <Field label="Phone">{e.emergencyContact.phone}</Field>
                <Field label="Relationship">{e.emergencyContact.relationship}</Field>
              </Grid>
            </ContentCard>
          </div>
        )}
        {tab === "Documents" && <EmployeeDocuments employeeId={id} />}
        {tab === "Contracts" && <ContractsList employeeId={id} />}
        {tab === "Leave" && <LeaveBalances employeeId={id} />}
        {tab === "Checklists" && <EmployeeTasks employeeId={id} />}
        {tab === "Account" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <EmployeeAccount employeeId={id} />
            <ContentCard title="Profile photo" description="Shown on the profile and org views. Images up to 10 MB.">
              <PhotoUpload employeeId={id} photoFileId={(e as { photoFileId?: string | null }).photoFileId ?? null} />
            </ContentCard>
          </div>
        )}
        {tab === "History" && (
          <ContentCard title="Employment history" description="Transfers, promotions, manager and status changes, newest first.">
            <HistoryTab id={id} />
          </ContentCard>
        )}
      </div>

      <EmployeeFormDialog open={dialog === "edit"} onOpenChange={(o) => setDialog(o ? "edit" : null)} employee={e} />
      {/* Mounted only while open so each opening starts from the current record. */}
      {dialog === "assign" && <AssignmentDialog employee={e} open onOpenChange={(o) => setDialog(o ? "assign" : null)} />}
      {dialog === "status" && <StatusDialog employee={e} open onOpenChange={(o) => setDialog(o ? "status" : null)} />}
      <ConfirmDialog
        open={dialog === "archive"}
        onOpenChange={(o) => setDialog(o ? "archive" : null)}
        title={`Archive ${e.fullName}?`}
        description="The record is hidden from lists but kept for history. Reassign any direct reports first."
        confirmLabel="Archive"
        destructive
        pending={archive.isPending}
        onConfirm={() => archive.mutate()}
      />
    </PageContainer>
  );
}
