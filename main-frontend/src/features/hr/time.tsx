"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Loader2, Plus, Trash2, UserX, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ActionDropdown } from "@/components/shared/action-dropdown";
import { DataTable, Pagination, SearchInput, type Column } from "@/components/shared/data-table";
import { FormField } from "@/components/shared/form";
import { ContentCard, PageContainer, PageHeader } from "@/components/shared/page";
import { SelectField } from "@/components/shared/select-field";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormAlert } from "@/features/auth/auth-card";
import { EmployeePicker, useLookups } from "@/features/employees/shared";
import { useListState } from "@/hooks/use-list-state";
import { useSession } from "@/hooks/use-session";
import { api, errorMessage } from "@/lib/api/client";
import { formatDate, today } from "@/lib/format";
import { cn } from "@/lib/utils";
import { attendancePoliciesConfig, leavePoliciesConfig, leaveTypesConfig, scheduleAssignmentsConfig } from "./configs";
import { col, CrudPage, hours, label, opts, Status, Tabs, time, useOptions, type Row } from "./kit";
import { ApprovalPanel, type Approval } from "./workflow";

const ATT_STATUSES = ["present", "late", "half_day", "absent", "on_leave", "holiday", "off"];
const monthStart = () => `${today().slice(0, 7)}-01`;

/* ── Attendance ── */

function RecordDialog({ open, onOpenChange, row }: { open: boolean; onOpenChange: (o: boolean) => void; row: Row | null }) {
  const qc = useQueryClient();
  const local = (iso: unknown) => (iso ? new Date(new Date(String(iso)).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
  const [v, setV] = useState({
    employee: row ? { id: String(row.employeeId), name: String(row.employeeName) } : null,
    workDate: (row?.workDate as string) ?? today(),
    checkIn: local(row?.checkIn),
    checkOut: local(row?.checkOut),
    notes: (row?.notes as string) ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api.post("attendance", {
        employeeId: v.employee?.id,
        workDate: v.workDate,
        checkIn: v.checkIn ? new Date(v.checkIn).toISOString() : null,
        checkOut: v.checkOut ? new Date(v.checkOut).toISOString() : null,
        notes: v.notes || null,
        source: "admin",
      }),
    onSuccess: () => {
      toast.success("Attendance saved");
      qc.invalidateQueries({ queryKey: ["attendance"] });
      onOpenChange(false);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{row ? "Edit attendance" : "Record attendance"}</DialogTitle>
          <DialogDescription>Times are in your browser&apos;s time zone. Late, early and overtime minutes are calculated from the employee&apos;s shift and branch time zone.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {error && (
            <div className="sm:col-span-2">
              <FormAlert>{error}</FormAlert>
            </div>
          )}
          <FormField label="Employee" className="sm:col-span-2">{(p) => <EmployeePicker {...p} value={v.employee} onChange={(e) => setV({ ...v, employee: e })} />}</FormField>
          <FormField label="Work date">{(p) => <Input {...p} type="date" value={v.workDate} onChange={(e) => setV({ ...v, workDate: e.target.value })} />}</FormField>
          <div />
          <FormField label="Check-in">{(p) => <Input {...p} type="datetime-local" value={v.checkIn} onChange={(e) => setV({ ...v, checkIn: e.target.value })} />}</FormField>
          <FormField label="Check-out (optional)">{(p) => <Input {...p} type="datetime-local" value={v.checkOut} onChange={(e) => setV({ ...v, checkOut: e.target.value })} />}</FormField>
          <FormField label="Notes (optional)" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />}</FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!v.employee || !v.workDate || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const attendanceColumns: Column<Row>[] = [
  col.date("workDate", "Date"),
  col.employee(),
  { key: "shift", header: "Shift", hideBelow: "lg", cell: (r) => <span className="text-[13px] text-muted-foreground">{(r.shiftName as string) ?? "—"}</span> },
  { key: "in", header: "In / out", cell: (r) => <span className="text-[13px] tabular-nums">{time(r.checkIn as string)} – {time(r.checkOut as string)}</span> },
  { key: "worked", header: "Worked", cell: (r) => <span className="tabular-nums">{hours(r.workedMinutes)}</span> },
  { key: "late", header: "Late / early", hideBelow: "md", cell: (r) => <span className="text-[13px] tabular-nums text-muted-foreground">{Number(r.lateMinutes) ? `${r.lateMinutes}m late` : ""}{Number(r.lateMinutes) && Number(r.earlyLeaveMinutes) ? " · " : ""}{Number(r.earlyLeaveMinutes) ? `${r.earlyLeaveMinutes}m early` : ""}{!Number(r.lateMinutes) && !Number(r.earlyLeaveMinutes) ? "—" : ""}</span> },
  { key: "ot", header: "OT", hideBelow: "md", cell: (r) => <span className="tabular-nums">{hours(r.overtimeMinutes)}</span> },
  col.status(),
  { key: "src", header: "Source", hideBelow: "lg", cell: (r) => <span className="text-xs text-muted-foreground">{label(r.source as string)}</span> },
];

function AttendanceRecords() {
  const { can } = useSession();
  const qc = useQueryClient();
  const lookups = useLookups();
  const list = useListState({ sort: "workDate", order: "desc" });
  const [f, setF] = useState({ from: monthStart(), to: today(), status: null as string | null, departmentId: null as string | null });
  const [dialog, setDialog] = useState<{ open: boolean; row: Row | null }>({ open: false, row: null });
  const params = { ...list.params, from: f.from, to: f.to, status: f.status ?? undefined, departmentId: f.departmentId ?? undefined };
  const q = useQuery({ queryKey: ["attendance", params], queryFn: () => api.list<Row>("attendance", params), placeholderData: (p) => p });
  const markMissing = useMutation({
    mutationFn: (date: string) => api.post<{ created: number }>("attendance/mark-missing", { date }),
    onSuccess: (r) => {
      toast.success(`${r.data.created} absence(s) recorded`);
      qc.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`attendance/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }) });
  const manage = can("attendance:manage");
  return (
    <div className="space-y-4">
      {manage && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={markMissing.isPending} onClick={() => markMissing.mutate(f.to)}>
            <UserX /> Mark missing for {formatDate(f.to)}
          </Button>
          <Button onClick={() => setDialog({ open: true, row: null })}>
            <Plus /> Record attendance
          </Button>
        </div>
      )}
      <DataTable
        columns={[
          ...attendanceColumns,
          {
            key: "a",
            header: "",
            className: "w-12",
            cell: (r) =>
              manage && (
                <div onClick={(e) => e.stopPropagation()}>
                  <ActionDropdown items={[{ label: "Edit", icon: Clock, onSelect: () => setDialog({ open: true, row: r }) }, { label: "Delete", icon: Trash2, destructive: true, onSelect: () => remove.mutate(r.id) }]} />
                </div>
              ),
          },
        ]}
        rows={q.data?.items}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error?.message}
        onRetry={() => q.refetch()}
        toolbar={
          <>
            <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search employee" />
            <Input type="date" aria-label="From" className="w-40" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
            <Input type="date" aria-label="To" className="w-40" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
            <div className="w-40">
              <SelectField value={f.status} onChange={(s) => setF({ ...f, status: s })} options={opts(ATT_STATUSES)} noneLabel="All statuses" />
            </div>
            <div className="w-44">
              <SelectField value={f.departmentId} onChange={(s) => setF({ ...f, departmentId: s })} options={lookups.departments} noneLabel="All departments" />
            </div>
          </>
        }
        empty={<EmptyState icon={Clock} title="No attendance in this range" />}
        footer={<Pagination meta={q.data?.meta} onPageChange={list.setPage} onLimitChange={list.setLimit} />}
      />
      {dialog.open && <RecordDialog open onOpenChange={(o) => setDialog({ open: o, row: null })} row={dialog.row} />}
    </div>
  );
}

function AttendanceSummary() {
  const [f, setF] = useState({ from: monthStart(), to: today() });
  const q = useQuery({ queryKey: ["attendance", "summary", f], queryFn: () => api.get<Row[]>("attendance/summary", f) });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input type="date" aria-label="From" className="w-40" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <Input type="date" aria-label="To" className="w-40" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <a className="ml-auto" href={`/api/reports/attendance?format=csv&from=${f.from}&to=${f.to}`}>
          <Button variant="outline">Export CSV</Button>
        </a>
      </div>
      <DataTable
        columns={[
          col.employee(),
          col.text("presentDays", "Present"),
          col.text("lateDays", "Late"),
          col.text("absentDays", "Absent"),
          col.text("leaveDays", "Leave", { hideBelow: "md" }),
          col.text("earlyDepartures", "Early out", { hideBelow: "md" }),
          col.text("missingCheckouts", "No check-out", { hideBelow: "lg" }),
          { key: "w", header: "Worked", cell: (r) => hours(r.workedMinutes) },
          { key: "o", header: "Overtime", cell: (r) => hours(r.overtimeMinutes) },
        ]}
        rows={q.data?.map((r) => ({ ...r, id: String(r.employeeId) }) as Row)}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error?.message}
        empty={<EmptyState icon={Clock} title="No attendance in this range" />}
      />
    </div>
  );
}

export function CorrectionDialog({ open, onOpenChange, forEmployee }: { open: boolean; onOpenChange: (o: boolean) => void; forEmployee?: boolean }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ employee: null as { id: string; name: string } | null, workDate: today(), checkIn: "", checkOut: "", reason: "" });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api.post("attendance-corrections", {
        employeeId: forEmployee ? v.employee?.id : undefined,
        workDate: v.workDate,
        checkIn: new Date(v.checkIn).toISOString(),
        checkOut: v.checkOut ? new Date(v.checkOut).toISOString() : null,
        reason: v.reason,
      }),
    onSuccess: () => {
      toast.success("Correction submitted for approval");
      qc.invalidateQueries({ queryKey: ["corrections"] });
      onOpenChange(false);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Request attendance correction</DialogTitle>
          <DialogDescription>Missed a punch or the device failed? Once approved, the day is recalculated.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {error && (
            <div className="sm:col-span-2">
              <FormAlert>{error}</FormAlert>
            </div>
          )}
          {forEmployee && <FormField label="Employee" className="sm:col-span-2">{(p) => <EmployeePicker {...p} value={v.employee} onChange={(e) => setV({ ...v, employee: e })} />}</FormField>}
          <FormField label="Work date">{(p) => <Input {...p} type="date" value={v.workDate} onChange={(e) => setV({ ...v, workDate: e.target.value })} />}</FormField>
          <div />
          <FormField label="Actual check-in">{(p) => <Input {...p} type="datetime-local" value={v.checkIn} onChange={(e) => setV({ ...v, checkIn: e.target.value })} />}</FormField>
          <FormField label="Actual check-out">{(p) => <Input {...p} type="datetime-local" value={v.checkOut} onChange={(e) => setV({ ...v, checkOut: e.target.value })} />}</FormField>
          <FormField label="Reason" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />}</FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!v.checkIn || v.reason.trim().length < 3 || (forEmployee && !v.employee) || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="animate-spin" />} Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CorrectionsList({ mine }: { mine?: boolean }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["corrections", mine], queryFn: () => api.get<Row[]>("attendance-corrections") });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`attendance-corrections/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["corrections"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus /> Request correction
        </Button>
      </div>
      <DataTable
        columns={[
          col.date("workDate", "Date"),
          ...(mine ? [] : [col.employee()]),
          { key: "t", header: "Requested times", cell: (r) => <span className="tabular-nums text-[13px]">{time(r.checkIn as string)} – {time(r.checkOut as string)}</span> },
          col.text("reason", "Reason"),
          col.status(),
          { key: "x", header: "", className: "w-12", cell: (r) => r.status === "pending" && <Button variant="ghost" size="icon-sm" aria-label="Cancel" onClick={() => cancel.mutate(r.id)}><X /></Button> },
        ]}
        rows={q.data}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error?.message}
        empty={<EmptyState icon={Clock} title="No correction requests" />}
      />
      {open && <CorrectionDialog open onOpenChange={setOpen} forEmployee={!mine && can("attendance:manage")} />}
    </div>
  );
}

export function AttendancePage() {
  const { can } = useSession();
  const tabs = [
    { value: "records", label: "Daily attendance" },
    ...(can("attendance:read") ? [{ value: "summary", label: "Summary report" }] : []),
    { value: "corrections", label: "Corrections" },
    ...(can("attendance:manage") ? [{ value: "policies", label: "Policies" }] : []),
  ] as { value: string; label: string }[];
  const [tab, setTab] = useState(() => (typeof window !== "undefined" && new URLSearchParams(location.search).get("tab")) || "records");
  return (
    <PageContainer>
      <PageHeader title="Attendance" description="Check-ins, manual and device entries, late arrivals, early departures, overtime and missing attendance." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "records" && <AttendanceRecords />}
      {tab === "summary" && <AttendanceSummary />}
      {tab === "corrections" && <CorrectionsList />}
      {tab === "policies" && <CrudPage config={attendancePoliciesConfig} embedded />}
    </PageContainer>
  );
}

/* ── Work schedules ── */

interface Schedule {
  id: string;
  name: string;
  rotationWeeks: number;
  description: string | null;
  isActive: boolean;
  employeeCount: number;
  days: { weekIndex: number; weekday: number; shiftId: string | null }[];
}
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ScheduleEditor({ schedule, onClose }: { schedule: Schedule | null; onClose: () => void }) {
  const qc = useQueryClient();
  const shifts = useOptions("shifts", (r) => `${r.name} (${String(r.startTime).slice(0, 5)}–${String(r.endTime).slice(0, 5)})`, { isActive: true });
  const [name, setName] = useState(schedule?.name ?? "");
  const [weeks, setWeeks] = useState(schedule?.rotationWeeks ?? 1);
  const [grid, setGrid] = useState<Record<string, string | null>>(() => Object.fromEntries((schedule?.days ?? []).map((d) => [`${d.weekIndex}-${d.weekday}`, d.shiftId])));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        rotationWeeks: weeks,
        days: Object.entries(grid)
          .filter(([k, v]) => v && Number(k.split("-")[0]) < weeks)
          .map(([k, v]) => ({ weekIndex: Number(k.split("-")[0]), weekday: Number(k.split("-")[1]), shiftId: v })),
      };
      return schedule ? api.put(`work-schedules/${schedule.id}`, body) : api.post("work-schedules", body);
    },
    onSuccess: () => {
      toast.success("Schedule saved");
      qc.invalidateQueries({ queryKey: ["work-schedules"] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{schedule ? "Edit schedule" : "New schedule"}</DialogTitle>
          <DialogDescription>Pick a shift for each working day. Empty days are days off (weekend). Rotations repeat every N weeks from each employee&apos;s assignment date.</DialogDescription>
        </DialogHeader>
        {error && <FormAlert>{error}</FormAlert>}
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <FormField label="Name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</FormField>
          <FormField label="Rotation (weeks)">{(p) => <SelectField {...p} value={String(weeks)} onChange={(v) => setWeeks(Number(v ?? 1))} options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n} week${n > 1 ? "s" : ""}` }))} />}</FormField>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr>
                <th className="w-16" />
                {WEEKDAYS.map((d) => (
                  <th key={d} className="px-1 pb-2 text-left font-medium text-muted-foreground">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: weeks }, (_, w) => (
                <tr key={w}>
                  <td className="pr-2 text-xs text-muted-foreground">Week {w + 1}</td>
                  {WEEKDAYS.map((_, i) => (
                    <td key={i} className="p-1">
                      <SelectField value={grid[`${w}-${i + 1}`] ?? null} onChange={(v) => setGrid({ ...grid, [`${w}-${i + 1}`]: v })} options={shifts} noneLabel="Off" placeholder="Off" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="animate-spin" />} Save schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SchedulesPage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const [tab, setTab] = useState("schedules");
  const [editing, setEditing] = useState<Schedule | null | "new">(null);
  const q = useQuery({ queryKey: ["work-schedules"], queryFn: () => api.get<Schedule[]>("work-schedules") });
  const shifts = useOptions("shifts", (r) => String(r.code));
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`work-schedules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["work-schedules"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const shiftCode = (id: string | null) => shifts.find((s) => s.value === id)?.label;
  return (
    <PageContainer>
      <PageHeader
        title="Work schedules"
        description="Weekly and rotating patterns of shifts, working days and weekends — every organization can differ."
        actions={can("shifts:manage") && tab === "schedules" && <Button onClick={() => setEditing("new")}><Plus /> New schedule</Button>}
      />
      <Tabs tabs={[{ value: "schedules", label: "Schedules" }, { value: "assignments", label: "Employee assignments" }]} value={tab} onChange={setTab} />
      {tab === "assignments" ? (
        <CrudPage config={scheduleAssignmentsConfig} embedded />
      ) : q.isPending ? (
        <LoadingState />
      ) : q.error ? (
        <ErrorState message={q.error.message} />
      ) : q.data.length === 0 ? (
        <div className="rounded-xl border bg-card"><EmptyState icon={CalendarDays} title="No schedules yet" description="Create shifts first, then combine them into a weekly schedule." /></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {q.data.map((s) => (
            <ContentCard
              key={s.id}
              title={s.name}
              description={`${s.rotationWeeks > 1 ? `${s.rotationWeeks}-week rotation · ` : ""}${s.employeeCount} employee(s)`}
              actions={
                can("shifts:manage") && (
                  <ActionDropdown items={[{ label: "Edit", icon: Clock, onSelect: () => setEditing(s) }, { label: "Delete", icon: Trash2, destructive: true, onSelect: () => remove.mutate(s.id) }]} />
                )
              }
            >
              <div className="space-y-1.5">
                {Array.from({ length: s.rotationWeeks }, (_, w) => (
                  <div key={w} className="grid grid-cols-7 gap-1">
                    {WEEKDAYS.map((d, i) => {
                      const day = s.days.find((x) => x.weekIndex === w && x.weekday === i + 1);
                      return (
                        <div key={d} className={cn("rounded-md border px-1 py-1.5 text-center text-[11px]", day?.shiftId ? "bg-brand-accent/10 font-medium" : "bg-subtle text-text-muted")}>
                          <div className="text-[10px] text-muted-foreground">{d}</div>
                          {day?.shiftId ? shiftCode(day.shiftId) : "Off"}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </ContentCard>
          ))}
        </div>
      )}
      {editing && <ScheduleEditor schedule={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </PageContainer>
  );
}

/* ── Leave ── */

export function ApplyLeaveDialog({ open, onOpenChange, onBehalf }: { open: boolean; onOpenChange: (o: boolean) => void; onBehalf?: boolean }) {
  const qc = useQueryClient();
  const types = useOptions("leave-types", (r) => String(r.name), { isActive: true });
  const [v, setV] = useState({ employee: null as { id: string; name: string } | null, leaveTypeId: null as string | null, startDate: today(), endDate: today(), halfDay: null as string | null, reason: "" });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.post("leave-requests", { employeeId: onBehalf ? v.employee?.id : undefined, leaveTypeId: v.leaveTypeId, startDate: v.startDate, endDate: v.halfDay ? v.startDate : v.endDate, halfDay: v.halfDay, reason: v.reason || null }),
    onSuccess: () => {
      toast.success("Leave request submitted");
      qc.invalidateQueries({ queryKey: ["leave"] });
      onOpenChange(false);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Apply for leave</DialogTitle>
          <DialogDescription>Days are counted on your working days only (holidays and days off are excluded).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {error && (
            <div className="sm:col-span-2">
              <FormAlert>{error}</FormAlert>
            </div>
          )}
          {onBehalf && <FormField label="Employee" className="sm:col-span-2">{(p) => <EmployeePicker {...p} value={v.employee} onChange={(e) => setV({ ...v, employee: e })} />}</FormField>}
          <FormField label="Leave type">{(p) => <SelectField {...p} value={v.leaveTypeId} onChange={(x) => setV({ ...v, leaveTypeId: x })} options={types} />}</FormField>
          <FormField label="Duration">{(p) => <SelectField {...p} value={v.halfDay ?? "full"} onChange={(x) => setV({ ...v, halfDay: x === "full" ? null : x })} options={[{ value: "full", label: "Full day(s)" }, { value: "am", label: "Half day — morning" }, { value: "pm", label: "Half day — afternoon" }]} />}</FormField>
          <FormField label={v.halfDay ? "Date" : "From"}>{(p) => <Input {...p} type="date" value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value, endDate: e.target.value > v.endDate ? e.target.value : v.endDate })} />}</FormField>
          {!v.halfDay && <FormField label="To">{(p) => <Input {...p} type="date" min={v.startDate} value={v.endDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} />}</FormField>}
          <FormField label="Reason (optional)" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />}</FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!v.leaveTypeId || (onBehalf && !v.employee) || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="animate-spin" />} Submit request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeaveDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["leave", "detail", id], queryFn: () => api.get<Row & { approval: Approval | null }>(`leave-requests/${id}`) });
  const [reason, setReason] = useState("");
  const cancel = useMutation({
    mutationFn: () => api.post(`leave-requests/${id}/cancel`, { reason: reason || null }),
    onSuccess: () => {
      toast.success("Leave cancelled");
      qc.invalidateQueries({ queryKey: ["leave"] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const r = q.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{r ? `${r.leaveTypeName}: ${r.employeeName}` : "Leave request"}</DialogTitle>
          {r && (
            <DialogDescription>
              {formatDate(r.startDate as string)}
              {r.startDate !== r.endDate && ` – ${formatDate(r.endDate as string)}`} · {Number(r.days)} day(s){r.halfDay ? ` (${r.halfDay === "am" ? "morning" : "afternoon"})` : ""}
            </DialogDescription>
          )}
        </DialogHeader>
        {!r ? (
          <LoadingState rows={3} />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2"><Status value={r.status as string} />{r.decisionComment ? <span className="text-[13px] text-muted-foreground">“{String(r.decisionComment)}”</span> : null}</div>
            {r.reason ? <p className="text-[13px]">{String(r.reason)}</p> : null}
            {r.approval && <ApprovalPanel approval={r.approval} onDone={onClose} />}
            {["pending", "approved"].includes(r.status as string) && (
              <div className="flex gap-2 border-t pt-4">
                <Input placeholder="Cancellation reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
                <Button variant="outline" className="text-danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                  Cancel leave
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function LeaveRequestsList({ mine }: { mine?: boolean }) {
  const { can } = useSession();
  const lookups = useLookups(!mine);
  const types = useOptions("leave-types", (r) => String(r.name));
  const list = useListState({ sort: "startDate", order: "desc" });
  const [f, setF] = useState({ status: null as string | null, leaveTypeId: null as string | null, departmentId: null as string | null });
  const [apply, setApply] = useState(false);
  const [open, setOpen] = useState<string | null>(() => (typeof window !== "undefined" ? new URLSearchParams(location.search).get("request") : null));
  const params = { ...list.params, status: f.status ?? undefined, leaveTypeId: f.leaveTypeId ?? undefined, departmentId: f.departmentId ?? undefined };
  const q = useQuery({ queryKey: ["leave", "list", params, mine], queryFn: () => api.list<Row>("leave-requests", params), placeholderData: (p) => p });
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setApply(true)}>
          <Plus /> {mine ? "Apply for leave" : "New leave request"}
        </Button>
      </div>
      <DataTable
        columns={[
          ...(mine ? [] : [col.employee()]),
          { key: "type", header: "Type", cell: (r) => <span className="inline-flex items-center gap-1.5 text-[13px]"><span className="size-2 rounded-full" style={{ background: (r.leaveTypeColor as string) ?? "#94a3b8" }} />{String(r.leaveTypeName)}</span> },
          { key: "dates", header: "Dates", cell: (r) => <span className="text-[13px] tabular-nums">{formatDate(r.startDate as string)}{r.startDate !== r.endDate && ` – ${formatDate(r.endDate as string)}`}</span> },
          { key: "days", header: "Days", cell: (r) => <span className="tabular-nums">{Number(r.days)}{r.halfDay ? ` (${r.halfDay})` : ""}</span> },
          col.status(),
        ]}
        rows={q.data?.items}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error?.message}
        onRowClick={(r) => setOpen(r.id)}
        toolbar={
          <>
            {!mine && <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search employee" />}
            <div className="w-36"><SelectField value={f.status} onChange={(s) => setF({ ...f, status: s })} options={opts(["pending", "approved", "rejected", "cancelled"])} noneLabel="All statuses" /></div>
            <div className="w-40"><SelectField value={f.leaveTypeId} onChange={(s) => setF({ ...f, leaveTypeId: s })} options={types} noneLabel="All types" /></div>
            {!mine && <div className="w-44"><SelectField value={f.departmentId} onChange={(s) => setF({ ...f, departmentId: s })} options={lookups.departments} noneLabel="All departments" /></div>}
          </>
        }
        empty={<EmptyState icon={CalendarDays} title="No leave requests" />}
        footer={<Pagination meta={q.data?.meta} onPageChange={list.setPage} onLimitChange={list.setLimit} />}
      />
      {apply && <ApplyLeaveDialog open onOpenChange={setApply} onBehalf={!mine && can("leave:create")} />}
      {open && <LeaveDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function LeaveRequestsPage() {
  return (
    <PageContainer>
      <PageHeader title="Leave requests" description="Applications, approvals, rejections and cancellations. Your team's requests appear in Approvals." />
      <LeaveRequestsList />
    </PageContainer>
  );
}

export function LeaveSetupPage({ which }: { which: "types" | "policies" }) {
  return <CrudPage config={which === "types" ? leaveTypesConfig : leavePoliciesConfig} />;
}

export function LeaveCalendarPage() {
  const lookups = useLookups();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [departmentId, setDept] = useState<string | null>(null);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const days = new Date(y, m, 0).getDate();
  const from = `${month}-01`;
  const to = `${month}-${String(days).padStart(2, "0")}`;
  const q = useQuery({ queryKey: ["leave", "calendar", from, departmentId], queryFn: () => api.get<Row[]>("leave-calendar", { from, to, departmentId: departmentId ?? undefined }) });
  const hol = useQuery({ queryKey: ["holidays-calendar", y], queryFn: () => api.get<{ date: string; name: string }[]>("holidays-calendar", { year: y }) });
  const shift = (d: number) => {
    const dt = new Date(y, m - 1 + d, 1);
    setMonth(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`);
  };
  const people = new Map<string, { name: string; items: Row[] }>();
  for (const r of q.data ?? []) {
    const p = people.get(String(r.employeeId)) ?? { name: String(r.employeeName), items: [] };
    p.items.push(r);
    people.set(String(r.employeeId), p);
  }
  const holidays = new Map((hol.data ?? []).map((h) => [h.date, h.name]));
  const dayStr = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
  return (
    <PageContainer>
      <PageHeader title="Leave calendar" description="Who is away, by day. Pending requests are shown hatched." />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft /></Button>
        <span className="w-40 text-center text-sm font-semibold">{new Date(y, m - 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        <Button variant="outline" size="icon" aria-label="Next month" onClick={() => shift(1)}><ChevronRight /></Button>
        <div className="ml-auto w-48"><SelectField value={departmentId} onChange={setDept} options={lookups.departments} noneLabel="All departments" /></div>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        {q.isPending ? (
          <LoadingState className="p-5" />
        ) : people.size === 0 ? (
          <EmptyState icon={CalendarDays} title="No leave this month" />
        ) : (
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr>
                <th className="sticky left-0 min-w-40 border-b bg-card px-3 py-2 text-left text-[13px] font-medium">Employee</th>
                {Array.from({ length: days }, (_, i) => {
                  const ds = dayStr(i + 1);
                  const wd = new Date(y, m - 1, i + 1).getDay();
                  return (
                    <th key={i} title={holidays.get(ds)} className={cn("min-w-7 border-b px-0.5 py-2 text-center font-medium", (wd === 0 || wd === 6) && "bg-subtle text-text-muted", holidays.has(ds) && "text-danger")}>
                      {i + 1}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {[...people.entries()].map(([id, p]) => (
                <tr key={id} className="border-b border-border-subtle last:border-0">
                  <td className="sticky left-0 bg-card px-3 py-1.5 text-[13px] whitespace-nowrap">{p.name}</td>
                  {Array.from({ length: days }, (_, i) => {
                    const ds = dayStr(i + 1);
                    const hit = p.items.find((r) => String(r.startDate) <= ds && String(r.endDate) >= ds);
                    return (
                      <td key={i} className="p-0.5" title={hit ? `${hit.leaveTypeName} (${hit.status})` : undefined}>
                        {hit && (
                          <div
                            className={cn("h-5 rounded-sm", hit.status === "pending" && "opacity-60 [background-image:repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(255,255,255,.5)_3px,rgba(255,255,255,.5)_6px)]", Boolean(hit.halfDay) && "w-1/2")}
                            style={{ backgroundColor: (hit.leaveTypeColor as string) ?? "#64748b" }}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PageContainer>
  );
}

/** Leave balances for an employee (self-service + employee detail). */
export function LeaveBalances({ employeeId }: { employeeId: string }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const q = useQuery({ queryKey: ["leave", "balances", employeeId, year], queryFn: () => api.get<Row[]>(`employees/${employeeId}/leave-balances`, { year }) });
  const [adjust, setAdjust] = useState<{ leaveTypeId: string; name: string } | null>(null);
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: () => api.post("leave-balances/adjust", { employeeId, leaveTypeId: adjust!.leaveTypeId, year, days: Number(days), reason }),
    onSuccess: () => {
      toast.success("Balance adjusted");
      setAdjust(null);
      qc.invalidateQueries({ queryKey: ["leave", "balances", employeeId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon-sm" aria-label="Previous year" onClick={() => setYear(year - 1)}><ChevronLeft /></Button>
        <span className="text-sm font-semibold tabular-nums">{year}</span>
        <Button variant="outline" size="icon-sm" aria-label="Next year" onClick={() => setYear(year + 1)}><ChevronRight /></Button>
      </div>
      {q.isPending ? (
        <LoadingState rows={2} />
      ) : q.error ? (
        <ErrorState message={q.error.message} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No leave types configured" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {q.data.map((b) => (
            <div key={String(b.leaveTypeId)} className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[13px] font-medium"><span className="size-2 rounded-full" style={{ background: (b.color as string) ?? "#94a3b8" }} />{String(b.leaveTypeName)}</span>
                {can("leave:manage") && <button className="text-xs text-brand-accent hover:underline" onClick={() => setAdjust({ leaveTypeId: String(b.leaveTypeId), name: String(b.leaveTypeName) })}>Adjust</button>}
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{Number(b.available)}<span className="ml-1 text-xs font-normal text-muted-foreground">days left</span></p>
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {Number(b.accrued)} accrued{Number(b.carriedForward) ? ` + ${Number(b.carriedForward)} carried` : ""}{Number(b.adjustment) ? ` ${Number(b.adjustment) > 0 ? "+" : "−"} ${Math.abs(Number(b.adjustment))} adj.` : ""} · {Number(b.used)} used{Number(b.pending) ? ` · ${Number(b.pending)} pending` : ""}
              </p>
            </div>
          ))}
        </div>
      )}
      <Dialog open={Boolean(adjust)} onOpenChange={(o) => !o && setAdjust(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust {adjust?.name}</DialogTitle>
            <DialogDescription>Positive adds days, negative removes them. Recorded in the audit log.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <FormField label="Days (±, half days allowed)">{(p) => <Input {...p} type="number" step="0.5" value={days} onChange={(e) => setDays(e.target.value)} />}</FormField>
            <FormField label="Reason">{(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}</FormField>
          </div>
          <DialogFooter>
            <Button disabled={!Number(days) || reason.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
