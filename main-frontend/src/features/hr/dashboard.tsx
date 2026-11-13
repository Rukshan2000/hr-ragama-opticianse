"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Cake, ClipboardCheck, Clock, FileWarning, Inbox, Plane, UserPlus, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { ContentCard, StatCard } from "@/components/shared/page";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { api } from "@/lib/api/client";
import { formatDate, formatDateTime } from "@/lib/format";
import { label, money, MONTHS, Status } from "./kit";

interface Dash {
  today: string;
  pendingApprovals: number;
  headcount?: { total: number; active: number; onboarding: number; newJoiners: number; byDepartment: { label: string; value: number }[]; byStatus: { label: string; value: number }[] };
  recentJoiners?: { id: string; name: string; joiningDate: string }[];
  upcomingBirthdays?: { id: string; name: string; nextDate: string }[];
  attendance?: { today: { present: number; late: number; absent: number; checked_in: number }; trend: { date: string; present: number; late: number; absent: number }[] };
  onLeaveToday?: { id: string; name: string; leaveType: string; until: string }[];
  expiringContracts?: { id: string; contractNumber: string; endDate: string; name: string }[];
  payroll?: { id: string; year: number; month: number; status: string; totalNet: string; employeeCount: number }[];
  recentActivity?: { id: string; action: string; entityType: string; createdAt: string; actorName: string | null }[];
}

function Bars({ data, max }: { data: { label: string; value: number }[]; max?: number }) {
  const top = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-2">
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] items-center gap-2 text-[13px]">
          <span className="truncate text-muted-foreground">{d.label}</span>
          <span className="h-2 rounded-full bg-subtle" aria-hidden>
            <span className="block h-2 rounded-full bg-brand-accent" style={{ width: `${(d.value / top) * 100}%` }} />
          </span>
          <span className="text-right tabular-nums">{d.value}</span>
        </li>
      ))}
    </ul>
  );
}

function AttendanceTrend({ trend }: { trend: NonNullable<Dash["attendance"]>["trend"] }) {
  const top = Math.max(1, ...trend.map((t) => t.present + t.absent));
  if (!trend.length) return <EmptyState icon={Clock} title="No attendance recorded in the last two weeks" />;
  return (
    <div>
      <div className="flex h-36 items-end gap-1.5" role="img" aria-label="Attendance for the last 14 days">
        {trend.map((t) => (
          <div key={t.date} className="flex flex-1 flex-col justify-end gap-px" title={`${formatDate(t.date)}: ${t.present} present (${t.late} late), ${t.absent} absent`}>
            {t.absent > 0 && <span className="rounded-t-sm bg-danger/70" style={{ height: `${(t.absent / top) * 128}px` }} />}
            <span className="rounded-b-sm bg-success/80" style={{ height: `${((t.present - t.late) / top) * 128}px` }} />
            {t.late > 0 && <span className="bg-warning/80" style={{ height: `${(t.late / top) * 128}px` }} />}
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-text-muted">
        <span>{formatDate(trend[0]!.date)}</span>
        <span className="flex gap-3">
          <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-success/80" /> On time</span>
          <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-warning/80" /> Late</span>
          <span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-danger/70" /> Absent</span>
        </span>
        <span>{formatDate(trend.at(-1)!.date)}</span>
      </div>
    </div>
  );
}

const List = ({ children, empty }: { children: React.ReactNode[]; empty: string }) =>
  children.length ? <ul className="divide-y divide-border-subtle text-[13px]">{children}</ul> : <p className="py-6 text-center text-[13px] text-muted-foreground">{empty}</p>;

export function HrDashboard() {
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dash>("dashboard"), refetchInterval: 120_000 });
  if (q.error) return <div className="rounded-xl border bg-card"><ErrorState message={q.error.message} onRetry={() => q.refetch()} /></div>;
  const d = q.data;
  const loading = q.isPending;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(loading || d?.headcount) && <StatCard label="Employees" icon={Users} loading={loading} value={d?.headcount?.total} hint={d?.headcount && `${d.headcount.active} active · ${d.headcount.onboarding} onboarding/probation`} />}
        {(loading || d?.headcount) && <StatCard label="New joiners" icon={UserPlus} loading={loading} value={d?.headcount?.newJoiners} hint="This month" />}
        {(loading || d?.onLeaveToday) && <StatCard label="On leave today" icon={Plane} loading={loading} value={d?.onLeaveToday?.length} />}
        <Link href="/approvals" className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <StatCard label="Pending approvals" icon={Inbox} loading={loading} value={d?.pendingApprovals} hint="Waiting for your decision" />
        </Link>
        {d?.attendance && (
          <>
            <StatCard label="Present today" icon={ClipboardCheck} value={d.attendance.today.present} hint={`${d.attendance.today.checked_in} currently checked in`} />
            <StatCard label="Late arrivals" icon={Clock} value={d.attendance.today.late} hint="Today" />
            <StatCard label="Absent" icon={FileWarning} value={d.attendance.today.absent} hint="Marked absent today" />
          </>
        )}
        {d?.payroll && (
          <StatCard
            label="Last payroll"
            icon={Wallet}
            value={d.payroll[0] ? money(d.payroll[0].totalNet) : "—"}
            hint={d.payroll[0] ? `${MONTHS[d.payroll[0].month - 1]} ${d.payroll[0].year} · ${label(d.payroll[0].status)}` : "No payroll yet"}
          />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {d?.attendance && (
          <ContentCard title="Attendance — last 14 days" className="lg:col-span-2" actions={<Link href="/attendance" className="text-xs text-brand-accent hover:underline">Details</Link>}>
            <AttendanceTrend trend={d.attendance.trend} />
          </ContentCard>
        )}
        {d?.headcount && (
          <ContentCard title="Headcount by department">
            {d.headcount.byDepartment.length ? <Bars data={d.headcount.byDepartment.slice(0, 8)} /> : <p className="text-[13px] text-muted-foreground">No employees yet</p>}
          </ContentCard>
        )}
        {d?.onLeaveToday && (
          <ContentCard title="Away today" actions={<Link href="/leave/calendar" className="text-xs text-brand-accent hover:underline">Calendar</Link>}>
            <List empty="Everyone is in today">
              {d.onLeaveToday.map((l) => (
                <li key={l.id} className="flex justify-between py-2"><span>{l.name}</span><span className="text-muted-foreground">{l.leaveType} · until {formatDate(l.until)}</span></li>
              ))}
            </List>
          </ContentCard>
        )}
        {d?.upcomingBirthdays && (
          <ContentCard title={<span className="flex items-center gap-1.5"><Cake className="size-4 text-muted-foreground" /> Upcoming birthdays</span>}>
            <List empty="None in the next 30 days">
              {d.upcomingBirthdays.map((b) => (
                <li key={b.id} className="flex justify-between py-2"><Link href={`/employees/${b.id}`} className="hover:underline">{b.name}</Link><span className="text-muted-foreground">{formatDate(b.nextDate)}</span></li>
              ))}
            </List>
          </ContentCard>
        )}
        {d?.expiringContracts && (
          <ContentCard title={<span className="flex items-center gap-1.5"><CalendarClock className="size-4 text-muted-foreground" /> Contracts ending in 60 days</span>}>
            <List empty="No contracts ending soon">
              {d.expiringContracts.map((c) => (
                <li key={c.id} className="flex justify-between py-2"><span>{c.name} <span className="font-mono text-xs text-muted-foreground">{c.contractNumber}</span></span><span className="text-muted-foreground">{formatDate(c.endDate)}</span></li>
              ))}
            </List>
          </ContentCard>
        )}
        {d?.recentJoiners && (
          <ContentCard title="Recent joiners">
            <List empty="No one joined in the last 30 days">
              {d.recentJoiners.map((j) => (
                <li key={j.id} className="flex justify-between py-2"><Link href={`/employees/${j.id}`} className="hover:underline">{j.name}</Link><span className="text-muted-foreground">{formatDate(j.joiningDate)}</span></li>
              ))}
            </List>
          </ContentCard>
        )}
        {d?.payroll && d.payroll.length > 0 && (
          <ContentCard title="Payroll status" actions={<Link href="/payroll/runs" className="text-xs text-brand-accent hover:underline">Open</Link>}>
            <List empty="">
              {d.payroll.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2"><span>{MONTHS[p.month - 1]} {p.year}</span><span className="flex items-center gap-2 tabular-nums">{money(p.totalNet)} <Status value={p.status} /></span></li>
              ))}
            </List>
          </ContentCard>
        )}
        {d?.recentActivity && (
          <ContentCard title="Recent HR activity" className="lg:col-span-2">
            <List empty="No activity yet">
              {d.recentActivity.map((a) => (
                <li key={a.id} className="flex justify-between gap-3 py-2">
                  <span className="truncate"><span className="font-medium">{a.actorName ?? "System"}</span> <span className="text-muted-foreground">{a.action.replace(/[._]/g, " ")}</span></span>
                  <span className="shrink-0 text-xs text-text-muted">{formatDateTime(a.createdAt)}</span>
                </li>
              ))}
            </List>
          </ContentCard>
        )}
      </div>
    </div>
  );
}
