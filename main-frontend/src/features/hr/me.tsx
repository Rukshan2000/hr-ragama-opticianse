"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, LogIn, LogOut, Megaphone, Pin, Plus, UserCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DataTable, Pagination } from "@/components/shared/data-table";
import { FormField } from "@/components/shared/form";
import { ContentCard, PageContainer, PageHeader } from "@/components/shared/page";
import { EmptyState, LoadingState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormAlert } from "@/features/auth/auth-card";
import { useListState } from "@/hooks/use-list-state";
import { api, errorMessage } from "@/lib/api/client";
import { formatDate, today } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ClaimsList, MyAssets } from "./admin";
import { CrudDialog, label, Status, Tabs, time, type Row } from "./kit";
import { MyPayslips } from "./payroll";
import { EmployeeDocuments, PhotoUpload } from "./people";
import { ReviewsList } from "./talent";
import { attendanceColumns, CorrectionsList, LeaveBalances, LeaveRequestsList } from "./time";

interface Profile {
  employee: Row & { emergencyContact: { name: string | null; phone: string | null; relationship: string | null }; photoFileId: string | null; designation: { name: string } | null; department: { name: string } | null; manager: { name: string } | null };
  changeRequests: Row[];
}
interface Today {
  workDate: string;
  timezone: string;
  shift: { name: string; startTime: string; endTime: string } | null;
  record: Row | null;
}

function CheckInCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["attendance", "today"], queryFn: () => api.get<Today | null>("attendance/today"), refetchInterval: 60_000 });
  const act = useMutation({
    mutationFn: (a: "check-in" | "check-out") => api.post(`attendance/${a}`),
    onSuccess: (_, a) => {
      toast.success(a === "check-in" ? "Checked in" : "Checked out");
      qc.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const t = q.data;
  const open = t?.record?.checkIn && !t.record.checkOut;
  return (
    <ContentCard title="Today" description={t ? `${formatDate(t.workDate)} · ${t.timezone}` : undefined}>
      {!t ? (
        <LoadingState rows={1} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 text-[13px]">
            <p>{t.shift ? <>Shift <span className="font-medium">{t.shift.name}</span> · {t.shift.startTime.slice(0, 5)}–{t.shift.endTime.slice(0, 5)}</> : "No shift scheduled"}</p>
            <p className="text-muted-foreground">
              {t.record?.checkIn ? <>In {time(t.record.checkIn as string)}{t.record.checkOut ? <> · out {time(t.record.checkOut as string)}</> : null}</> : "Not checked in"}
              {t.record?.status ? <> · <Status value={t.record.status as string} /></> : null}
            </p>
          </div>
          {open ? (
            <Button size="lg" variant="outline" disabled={act.isPending} onClick={() => act.mutate("check-out")}>{act.isPending ? <Loader2 className="animate-spin" /> : <LogOut />} Check out</Button>
          ) : (
            <Button size="lg" disabled={act.isPending || Boolean(t.record?.checkOut)} onClick={() => act.mutate("check-in")}>{act.isPending ? <Loader2 className="animate-spin" /> : <LogIn />} Check in</Button>
          )}
        </div>
      )}
    </ContentCard>
  );
}

function Announcements() {
  const q = useQuery({ queryKey: ["announcements", "feed"], queryFn: () => api.get<Row[]>("announcements-feed") });
  return (
    <ContentCard title={<span className="flex items-center gap-1.5"><Megaphone className="size-4 text-muted-foreground" /> Announcements</span>}>
      {!q.data?.length ? (
        <p className="text-[13px] text-muted-foreground">No announcements.</p>
      ) : (
        <ul className="space-y-4">
          {q.data.map((a) => (
            <li key={a.id}>
              <p className="flex items-center gap-1.5 text-[13px] font-medium">{a.isPinned ? <Pin className="size-3.5 text-brand-accent" /> : null}{String(a.title)}</p>
              <p className="mt-0.5 text-[13px] whitespace-pre-wrap text-muted-foreground">{String(a.body)}</p>
              <p className="mt-1 text-[11px] text-text-muted">{formatDate(a.publishOn as string)}{a.authorName ? ` · ${a.authorName}` : ""}</p>
            </li>
          ))}
        </ul>
      )}
    </ContentCard>
  );
}

function ProfileTab({ p }: { p: Profile }) {
  const qc = useQueryClient();
  const e = p.employee;
  const initial = {
    phone: (e.phone as string) ?? "",
    address: (e.address as string) ?? "",
    emergencyContactName: e.emergencyContact.name ?? "",
    emergencyContactPhone: e.emergencyContact.phone ?? "",
    emergencyContactRelationship: e.emergencyContact.relationship ?? "",
    firstName: String(e.firstName),
    lastName: String(e.lastName),
    email: (e.email as string) ?? "",
    dateOfBirth: (e.dateOfBirth as string) ?? "",
  };
  const [v, setV] = useState(initial);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const changed = Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== initial[k as keyof typeof initial]).map(([k, x]) => [k, x === "" ? null : x]));
  const save = useMutation({
    mutationFn: () => api.patch<{ approvalRequested: boolean }>("me/profile", { ...changed, reason: reason || null }),
    onSuccess: (r) => {
      toast.success(r.message);
      setError(null);
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (x) => setError(errorMessage(x)),
  });
  const pending = p.changeRequests.find((c) => c.status === "pending");
  const field = (k: keyof typeof v, lbl: string, type = "text") => (
    <FormField label={lbl}>{(f) => <Input {...f} type={type} value={v[k]} onChange={(x) => setV({ ...v, [k]: x.target.value })} />}</FormField>
  );
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ContentCard title="Contact & emergency" description="Saved immediately.">
        <div className="grid gap-4 sm:grid-cols-2">
          {field("phone", "Phone")}
          {field("emergencyContactName", "Emergency contact")}
          {field("emergencyContactPhone", "Emergency phone")}
          {field("emergencyContactRelationship", "Relationship")}
          <FormField label="Address" className="sm:col-span-2">{(f) => <Textarea {...f} rows={2} value={v.address} onChange={(x) => setV({ ...v, address: x.target.value })} />}</FormField>
        </div>
      </ContentCard>
      <ContentCard title="Personal details" description="Changes here are sent to HR for approval.">
        <div className="grid gap-4 sm:grid-cols-2">
          {field("firstName", "First name")}
          {field("lastName", "Last name")}
          {field("email", "Work email", "email")}
          {field("dateOfBirth", "Date of birth", "date")}
          <FormField label="Reason for change" className="sm:col-span-2">{(f) => <Input {...f} value={reason} onChange={(x) => setReason(x.target.value)} />}</FormField>
        </div>
        {pending && <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">A change request is waiting for HR approval.</p>}
      </ContentCard>
      <div className="flex items-center justify-between gap-3 lg:col-span-2">
        <PhotoUpload employeeId={e.id} photoFileId={e.photoFileId} />
        <div className="flex items-center gap-3">
          {error && <FormAlert>{error}</FormAlert>}
          <Button disabled={!Object.keys(changed).length || save.isPending} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="animate-spin" />} Save changes</Button>
        </div>
      </div>
    </div>
  );
}

function MyAttendance() {
  const list = useListState({ sort: "workDate", order: "desc" });
  const q = useQuery({ queryKey: ["attendance", "mine", list.params], queryFn: () => api.list<Row>("attendance", list.params), placeholderData: (p) => p });
  return (
    <DataTable
      columns={attendanceColumns.filter((c) => c.key !== "employeeName" && c.key !== "src")}
      rows={q.data?.items}
      rowKey={(r) => r.id}
      loading={q.isPending}
      error={q.error?.message}
      empty={<EmptyState title="No attendance yet" />}
      footer={<Pagination meta={q.data?.meta} onPageChange={list.setPage} />}
    />
  );
}

function MySchedule({ employeeId }: { employeeId: string }) {
  const from = today();
  const end = new Date();
  end.setDate(end.getDate() + 13);
  const to = end.toLocaleDateString("en-CA");
  const q = useQuery({ queryKey: ["schedule", employeeId, from], queryFn: () => api.get<{ date: string; shift: { name: string; startTime: string; endTime: string } | null; scheduled: boolean; holiday: string | null; leave: number }[]>(`employees/${employeeId}/schedule`, { from, to }) });
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {(q.data ?? []).map((d) => (
        <div key={d.date} className={cn("rounded-lg border p-3 text-[13px]", d.date === from && "border-brand-accent")}>
          <p className="text-xs text-muted-foreground">{new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</p>
          <p className="mt-1 font-medium">
            {d.holiday ? <span className="text-danger">{d.holiday}</span> : d.leave >= 1 ? "On leave" : d.shift ? `${d.shift.startTime.slice(0, 5)}–${d.shift.endTime.slice(0, 5)}` : d.scheduled ? "Day off" : "No schedule"}
          </p>
          {d.shift && !d.holiday && <p className="text-xs text-muted-foreground">{d.shift.name}{d.leave === 0.5 ? " · half-day leave" : ""}</p>}
        </div>
      ))}
    </div>
  );
}

function Resignation() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["exit", "mine"], queryFn: () => api.get<Row | null>("exit-cases/mine") });
  const [open, setOpen] = useState(false);
  const withdraw = useMutation({ mutationFn: (id: string) => api.post(`exit-cases/${id}/withdraw`), onSuccess: () => qc.invalidateQueries({ queryKey: ["exit"] }), onError: (e) => toast.error(errorMessage(e)) });
  const x = q.data;
  return (
    <ContentCard title="Resignation" description="Submitting a resignation starts the approval and clearance process.">
      {x && ["pending", "approved"].includes(x.status as string) ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-[13px]">
          <p>Resignation submitted · last working day <span className="font-medium">{formatDate(x.lastWorkingDay as string)}</span> · <Status value={x.status as string} /></p>
          {x.status === "pending" && <Button variant="outline" size="sm" onClick={() => withdraw.mutate(x.id)}>Withdraw</Button>}
        </div>
      ) : (
        <Button variant="outline" className="text-danger" onClick={() => setOpen(true)}>Submit resignation</Button>
      )}
      {open && (
        <CrudDialog
          title="Submit resignation"
          description="Your manager and HR will review it. You can withdraw while it is pending."
          fields={[
            { name: "noticeDate", label: "Notice date", type: "date", required: true, default: today() },
            { name: "noticeDays", label: "Notice period (days)", type: "number", required: true, min: 0, default: "30" },
            { name: "reason", label: "Reason", type: "textarea" },
          ]}
          row={null}
          open
          submitLabel="Submit"
          onOpenChange={setOpen}
          onSubmit={async (b) => {
            await api.post("exit-cases", { ...b, exitType: "resignation" });
            toast.success("Resignation submitted");
            qc.invalidateQueries({ queryKey: ["exit"] });
          }}
        />
      )}
    </ContentCard>
  );
}

const TABS = [
  { value: "home", label: "Overview" },
  { value: "profile", label: "Profile" },
  { value: "leave", label: "Leave" },
  { value: "attendance", label: "Attendance" },
  { value: "schedule", label: "Schedule" },
  { value: "payslips", label: "Payslips" },
  { value: "documents", label: "Documents" },
  { value: "expenses", label: "Expenses" },
  { value: "assets", label: "Assets" },
  { value: "reviews", label: "Performance" },
];

export function MyWorkspace() {
  const q = useQuery({ queryKey: ["me", "profile"], queryFn: () => api.get<Profile | null>("me/profile") });
  const overview = useQuery({ queryKey: ["me", "overview"], queryFn: () => api.get<{ openTasks: Row[]; reviews: Row[]; pendingLeave: number } | null>("me/overview") });
  const [tab, setTab] = useState(() => (typeof window !== "undefined" && new URLSearchParams(location.search).get("tab")) || "home");
  if (q.isPending) return <PageContainer><LoadingState /></PageContainer>;
  if (!q.data)
    return (
      <PageContainer>
        <div className="rounded-xl border bg-card">
          <EmptyState icon={UserCircle} title="Your account isn't linked to an employee record" description="Ask HR to link your login to your employee profile to use self-service." />
        </div>
      </PageContainer>
    );
  const e = q.data.employee;
  return (
    <PageContainer>
      <PageHeader title={`Hi, ${e.firstName}`} description={[e.designation?.name, e.department?.name, e.manager && `reports to ${e.manager.name}`].filter(Boolean).join(" · ") || "My workspace"} />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === "home" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <CheckInCard />
            <ContentCard title="Leave balance" actions={<Button size="sm" variant="outline" onClick={() => setTab("leave")}><Plus /> Apply</Button>}>
              <LeaveBalances employeeId={e.id} />
            </ContentCard>
            {(overview.data?.openTasks.length ?? 0) > 0 && (
              <ContentCard title="My checklist">
                <ul className="divide-y divide-border-subtle text-[13px]">
                  {overview.data!.openTasks.map((t) => (
                    <li key={t.id} className="flex justify-between py-2"><span>{String(t.title)}</span><span className="text-muted-foreground">{label(t.kind as string)}{t.dueDate ? ` · due ${formatDate(t.dueDate as string)}` : ""}</span></li>
                  ))}
                </ul>
              </ContentCard>
            )}
          </div>
          <div className="space-y-6">
            <Announcements />
            <Resignation />
          </div>
        </div>
      )}
      {tab === "profile" && <ProfileTab p={q.data} />}
      {tab === "leave" && (
        <div className="space-y-6">
          <LeaveBalances employeeId={e.id} />
          <LeaveRequestsList mine />
        </div>
      )}
      {tab === "attendance" && (
        <div className="space-y-6">
          <MyAttendance />
          <ContentCard title="Correction requests"><CorrectionsList mine /></ContentCard>
        </div>
      )}
      {tab === "schedule" && <MySchedule employeeId={e.id} />}
      {tab === "payslips" && <MyPayslips />}
      {tab === "documents" && <EmployeeDocuments employeeId={e.id} />}
      {tab === "expenses" && <ClaimsList mine />}
      {tab === "assets" && <MyAssets />}
      {tab === "reviews" && <ReviewsList mine />}
    </PageContainer>
  );
}

