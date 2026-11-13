"use client";

import {
  BadgeDollarSign,
  BookOpen,
  Briefcase,
  CalendarDays,
  ClipboardCheck,
  Clock,
  Coins,
  ListChecks,
  Megaphone,
  PackageOpen,
  Receipt,
  ScrollText,
  Target,
  UserPlus,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api/client";
import { col, label, money, MONTHS, opts, Status, type CrudConfig } from "./kit";

const EMPLOYMENT_TYPES = ["permanent", "temporary", "contract", "internship"];
const named = (r: Record<string, unknown>) => String(r.name ?? r.title ?? "");
const codeNamed = (r: Record<string, unknown>) => `${r.code ? `${r.code} · ` : ""}${r.name ?? r.title}`;

/* ── Time ── */

export const shiftsConfig: CrudConfig = {
  queryKey: "shifts",
  title: "Shifts",
  singular: "Shift",
  description: "Working hours with grace periods. An end time at or before the start makes it an overnight shift.",
  icon: Clock,
  path: "shifts",
  managePermission: "shifts:manage",
  hasActive: true,
  defaultSort: { sort: "startTime", order: "asc" },
  fields: [
    { name: "code", label: "Code", type: "code", required: true },
    { name: "name", label: "Name", required: true },
    { name: "startTime", label: "Start", type: "time", required: true, default: "08:30" },
    { name: "endTime", label: "End", type: "time", required: true, default: "17:30" },
    { name: "breakMinutes", label: "Break (minutes)", type: "number", required: true, min: 0, max: 600, default: "60" },
    { name: "graceMinutes", label: "Late grace (minutes)", type: "number", required: true, min: 0, max: 240, default: "10" },
    { name: "earlyLeaveGraceMinutes", label: "Early-leave grace (minutes)", type: "number", required: true, min: 0, max: 240, default: "0" },
    { name: "color", label: "Color", type: "color", default: "#2563eb" },
  ],
  columns: [
    col.color(),
    col.code(),
    col.main("name", "Shift", undefined, "name"),
    {
      key: "hours",
      header: "Hours",
      sortKey: "startTime",
      cell: (r) => (
        <span className="text-[13px] tabular-nums">
          {String(r.startTime).slice(0, 5)} – {String(r.endTime).slice(0, 5)}
          {String(r.endTime) <= String(r.startTime) && <span className="ml-1.5 text-xs text-muted-foreground">(overnight)</span>}
        </span>
      ),
    },
    col.text("breakMinutes", "Break (min)", { hideBelow: "md" }),
    col.text("graceMinutes", "Grace (min)", { hideBelow: "lg" }),
  ],
};

export const holidaysConfig: CrudConfig = {
  queryKey: "holidays",
  title: "Holidays",
  singular: "Holiday",
  description: "Public and company holidays, for all branches or one branch. Recurring holidays repeat on the same date each year.",
  icon: CalendarDays,
  path: "holidays",
  managePermission: "holidays:manage",
  defaultSort: { sort: "holidayDate", order: "asc" },
  filters: [{ key: "type", label: "Type", options: opts(["public", "company"]) }],
  fields: [
    { name: "name", label: "Name", required: true, wide: true },
    { name: "holidayDate", label: "Date", type: "date", required: true },
    { name: "type", label: "Type", type: "select", required: true, options: opts(["public", "company"]), default: "public" },
    { name: "branchId", label: "Branch", type: "ref", ref: { path: "organization/branches", label: named }, hint: "Leave empty for all branches" },
    { name: "isRecurring", label: "Repeats every year", type: "boolean" },
    { name: "description", label: "Description", type: "textarea" },
  ],
  columns: [
    col.date("holidayDate", "Date", "holidayDate"),
    col.main("name", "Holiday", "description", "name"),
    { key: "type", header: "Type", cell: (r) => <Status value={r.type === "public" ? "open" : "scheduled"} /> },
    col.text("branchName", "Branch", { cell: (r) => <span className="text-[13px] text-muted-foreground">{(r.branchName as string) ?? "All branches"}</span> }),
    col.bool("isRecurring", "Recurring"),
  ],
};

export const scheduleAssignmentsConfig: CrudConfig = {
  queryKey: "schedule-assignments",
  title: "Schedule assignments",
  singular: "Assignment",
  description: "Which weekly schedule each employee follows, effective-dated. Rotations count weeks from the start date.",
  icon: CalendarDays,
  path: "schedule-assignments",
  managePermission: "shifts:manage",
  defaultSort: { sort: "effectiveFrom", order: "desc" },
  fields: [
    { name: "employeeId", label: "Employee", type: "employee", required: true, createOnly: true },
    { name: "scheduleId", label: "Schedule", type: "ref", required: true, ref: { path: "work-schedules", label: named } },
    { name: "effectiveFrom", label: "From", type: "date", required: true },
    { name: "effectiveTo", label: "Until", type: "date", hint: "Leave empty for open-ended" },
  ],
  columns: [col.employee(), col.text("scheduleName", "Schedule"), col.date("effectiveFrom", "From", "effectiveFrom"), col.date("effectiveTo", "Until")],
};

export const attendancePoliciesConfig: CrudConfig = {
  queryKey: "attendance-policies",
  title: "Attendance policies",
  singular: "Policy",
  description: "Effective-dated rules for overtime and half days.",
  icon: ClipboardCheck,
  path: "attendance-policies",
  managePermission: "attendance:manage",
  defaultSort: { sort: "effectiveFrom", order: "desc" },
  fields: [
    { name: "effectiveFrom", label: "Effective from", type: "date", required: true },
    { name: "overtimeThresholdMinutes", label: "Overtime counts after (minutes)", type: "number", required: true, min: 0, default: "30" },
    { name: "halfDayMinutes", label: "Half day below (minutes worked)", type: "number", required: true, min: 0, default: "240" },
    { name: "countWeekendAsOvertime", label: "Work on days off is overtime", type: "boolean", default: true },
  ],
  columns: [col.date("effectiveFrom", "Effective from", "effectiveFrom"), col.text("overtimeThresholdMinutes", "OT threshold (min)"), col.text("halfDayMinutes", "Half day (min)"), col.bool("countWeekendAsOvertime", "Day-off OT")],
};

/* ── Leave ── */

export const leaveTypesConfig: CrudConfig = {
  queryKey: "leave-types",
  title: "Leave types",
  singular: "Leave type",
  description: "Annual, casual, medical, no-pay and any other leave your organization grants.",
  icon: CalendarDays,
  path: "leave-types",
  managePermission: "leave:manage",
  hasActive: true,
  defaultSort: { sort: "name", order: "asc" },
  fields: [
    { name: "code", label: "Code", type: "code", required: true },
    { name: "name", label: "Name", required: true },
    { name: "isPaid", label: "Paid leave", type: "boolean", default: true, hint: "Unpaid days are deducted in payroll" },
    { name: "allowHalfDay", label: "Half days allowed", type: "boolean", default: true },
    { name: "allowNegative", label: "Allow negative balance", type: "boolean" },
    { name: "color", label: "Color", type: "color", default: "#16a34a" },
  ],
  columns: [col.color(), col.code(), col.main("name", "Leave type", undefined, "name"), col.bool("isPaid", "Paid"), col.bool("allowHalfDay", "Half days")],
};

export const leavePoliciesConfig: CrudConfig = {
  queryKey: "leave-policies",
  title: "Leave policies",
  singular: "Policy",
  description: "Effective-dated entitlements per leave type, optionally per employment type. The most specific policy applies.",
  icon: ScrollText,
  path: "leave-policies",
  managePermission: "leave:manage",
  defaultSort: { sort: "leaveType", order: "asc" },
  fields: [
    { name: "leaveTypeId", label: "Leave type", type: "ref", required: true, ref: { path: "leave-types", label: named } },
    { name: "employmentType", label: "Employment type", type: "select", options: opts(EMPLOYMENT_TYPES), hint: "Empty = everyone" },
    { name: "annualDays", label: "Days per year", type: "number", required: true, min: 0, max: 365, step: 0.5 },
    { name: "accrual", label: "Accrual", type: "select", required: true, options: [{ value: "annual", label: "Full amount on 1 Jan" }, { value: "monthly", label: "Monthly (1/12 per month)" }], default: "annual" },
    { name: "carryForwardMax", label: "Max carry-forward", type: "number", min: 0, step: 0.5, default: "0" },
    { name: "effectiveFrom", label: "Effective from", type: "date", required: true },
  ],
  columns: [
    col.main("leaveTypeName", "Leave type", undefined, "leaveType"),
    { key: "et", header: "Applies to", cell: (r) => <span className="text-[13px]">{r.employmentType ? label(r.employmentType as string) : "Everyone"}</span> },
    col.text("annualDays", "Days / year"),
    { key: "acc", header: "Accrual", cell: (r) => <span className="text-[13px] text-muted-foreground">{label(r.accrual as string)}</span> },
    col.text("carryForwardMax", "Carry-forward", { hideBelow: "md" }),
    col.date("effectiveFrom", "Effective", "effectiveFrom"),
  ],
};

/* ── Payroll ── */

export const salaryComponentsConfig: CrudConfig = {
  queryKey: "salary-components",
  title: "Salary components",
  singular: "Component",
  description: "Recurring allowances and deductions used in salary structures.",
  icon: Coins,
  path: "salary-components",
  managePermission: "payroll:manage",
  hasActive: true,
  defaultSort: { sort: "name", order: "asc" },
  filters: [{ key: "kind", label: "Kind", options: opts(["earning", "deduction"]) }],
  fields: [
    { name: "code", label: "Code", type: "code", required: true },
    { name: "name", label: "Name", required: true },
    { name: "kind", label: "Kind", type: "select", required: true, options: opts(["earning", "deduction"]), default: "earning" },
    { name: "isTaxable", label: "Taxable (APIT)", type: "boolean", default: true },
    { name: "isEpfApplicable", label: "Counts for EPF/ETF", type: "boolean" },
  ],
  columns: [col.code(), col.main("name", "Component", undefined, "name"), { key: "kind", header: "Kind", cell: (r) => <Status value={r.kind === "earning" ? "approved" : "pending"} /> }, col.bool("isTaxable", "Taxable"), col.bool("isEpfApplicable", "EPF")],
};

const bracketsToText = (b: unknown) => ((b as { upTo: number | null; rate: number }[]) ?? []).map((x) => `${x.upTo ?? ""}:${x.rate}`).join("\n");
const textToBrackets = (t: unknown) =>
  String(t ?? "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [up, rate] = l.split(":");
      return { upTo: up?.trim() ? Number(up) : null, rate: Number(rate) };
    });

export const payrollPoliciesConfig: CrudConfig = {
  queryKey: "payroll-policies",
  title: "Statutory policies",
  singular: "Payroll policy",
  description: "Effective-dated EPF, ETF, APIT and overtime rules. Rates are configuration, never code. Policies used by a finalized payroll are frozen.",
  icon: ScrollText,
  path: "payroll-policies",
  managePermission: "payroll:manage",
  defaultSort: { sort: "effectiveFrom", order: "desc" },
  fields: [
    { name: "effectiveFrom", label: "Effective from", type: "date", required: true },
    { name: "epfEmployeeRate", label: "EPF employee %", type: "number", required: true, min: 0, max: 100, step: 0.01 },
    { name: "epfEmployerRate", label: "EPF employer %", type: "number", required: true, min: 0, max: 100, step: 0.01 },
    { name: "etfRate", label: "ETF %", type: "number", required: true, min: 0, max: 100, step: 0.01 },
    { name: "overtimeMultiplier", label: "Overtime multiplier", type: "number", required: true, min: 0, max: 5, step: 0.01, default: "1.5" },
    { name: "workingDaysPerMonth", label: "Working days / month", type: "number", required: true, min: 1, max: 31, default: "30" },
    { name: "workingHoursPerDay", label: "Hours / day", type: "number", required: true, min: 1, max: 24, step: 0.5, default: "8" },
    {
      name: "apitText",
      label: "APIT monthly brackets",
      type: "textarea",
      required: true,
      hint: "One per line as limit:rate%. Leave the last limit empty, e.g. 150000:0 / 233333:6 / :36",
    },
    { name: "notes", label: "Notes", type: "textarea" },
  ],
  fromRow: (r) => ({ ...r, apitText: bracketsToText(r.apitBrackets) }),
  toBody: ({ apitText, ...rest }) => ({ ...rest, apitBrackets: textToBrackets(apitText) }),
  columns: [
    col.date("effectiveFrom", "Effective from", "effectiveFrom"),
    { key: "epf", header: "EPF (emp / er)", cell: (r) => <span className="tabular-nums">{Number(r.epfEmployeeRate)}% / {Number(r.epfEmployerRate)}%</span> },
    { key: "etf", header: "ETF", cell: (r) => <span className="tabular-nums">{Number(r.etfRate)}%</span> },
    { key: "apit", header: "APIT brackets", hideBelow: "md", cell: (r) => <span className="text-xs text-muted-foreground">{((r.apitBrackets as unknown[]) ?? []).length} slabs</span> },
    { key: "ot", header: "OT ×", hideBelow: "lg", cell: (r) => <span className="tabular-nums">{Number(r.overtimeMultiplier)}</span> },
  ],
};

export const loansConfig: CrudConfig = {
  queryKey: "loans",
  title: "Loans & advances",
  singular: "Loan",
  description: "Recovered automatically in instalments when a payroll is approved.",
  icon: Wallet,
  path: "loans",
  managePermission: "payroll:manage",
  noDelete: true,
  defaultSort: { sort: "startDate", order: "desc" },
  filters: [{ key: "status", label: "Status", options: opts(["active", "settled", "cancelled"]) }],
  fields: [
    { name: "employeeId", label: "Employee", type: "employee", required: true, createOnly: true },
    { name: "type", label: "Type", type: "select", required: true, options: opts(["loan", "advance"]), default: "loan", createOnly: true },
    { name: "principal", label: "Principal", type: "money", required: true, min: 0.01, createOnly: true },
    { name: "installment", label: "Monthly instalment", type: "money", required: true, min: 0.01 },
    { name: "startDate", label: "First deduction from", type: "date", required: true, createOnly: true },
    { name: "notes", label: "Notes", type: "textarea" },
  ],
  columns: [col.employee(), { key: "type", header: "Type", cell: (r) => label(r.type as string) }, col.money("principal", "Principal"), col.money("installment", "Instalment"), col.money("balance", "Balance"), col.status()],
};

export const adjustmentsConfig: CrudConfig = {
  queryKey: "payroll-adjustments",
  title: "Bonuses & adjustments",
  singular: "Adjustment",
  description: "One-off earnings (bonus, commission) and deductions for a payroll period. Finalized periods are closed; record corrections in the next open period.",
  icon: BadgeDollarSign,
  path: "payroll-adjustments",
  managePermission: "payroll:manage",
  defaultSort: { sort: "createdAt", order: "desc" },
  fields: [
    { name: "employeeId", label: "Employee", type: "employee", required: true, createOnly: true },
    { name: "year", label: "Year", type: "number", required: true, min: 2000, max: 2100, default: String(new Date().getFullYear()) },
    { name: "month", label: "Month", type: "select", required: true, options: MONTHS.map((m, i) => ({ value: String(i + 1), label: m })), default: String(new Date().getMonth() + 1) },
    { name: "kind", label: "Kind", type: "select", required: true, options: opts(["earning", "deduction"]), default: "earning" },
    { name: "label", label: "Label", required: true, hint: "Shown on the payslip, e.g. Q3 bonus" },
    { name: "amount", label: "Amount", type: "money", required: true, min: 0.01 },
    { name: "isTaxable", label: "Taxable", type: "boolean", default: true },
    { name: "isEpfApplicable", label: "Counts for EPF/ETF", type: "boolean" },
    { name: "reason", label: "Reason", type: "textarea" },
  ],
  fromRow: (r) => ({ ...r, month: String(r.month) }),
  toBody: (b) => ({ ...b, ...(b.month !== undefined && { month: Number(b.month) }) }),
  columns: [
    col.employee(),
    { key: "period", header: "Period", sortKey: "period", cell: (r) => <span className="tabular-nums">{MONTHS[Number(r.month) - 1]?.slice(0, 3)} {String(r.year)}</span> },
    col.main("label", "Item", "reason"),
    { key: "amount", header: "Amount", className: "text-right", cell: (r) => <span className={r.kind === "deduction" ? "text-danger tabular-nums" : "tabular-nums"}>{r.kind === "deduction" ? "−" : "+"}{money(r.amount)}</span> },
  ],
};

/* ── People ── */

export const checklistTemplatesConfig: CrudConfig = {
  queryKey: "checklist-templates",
  title: "Checklist templates",
  singular: "Checklist item",
  description: "Standard onboarding and exit tasks copied to each employee. Due days are relative to the joining date (onboarding) or last working day (exit).",
  icon: ListChecks,
  path: "checklist-templates",
  managePermission: "employees:manage",
  hasActive: true,
  defaultSort: { sort: "sortOrder", order: "asc" },
  filters: [{ key: "kind", label: "Checklist", options: opts(["onboarding", "exit"]) }],
  fields: [
    { name: "kind", label: "Checklist", type: "select", required: true, options: opts(["onboarding", "exit"]), default: "onboarding" },
    { name: "title", label: "Task", required: true, wide: true },
    { name: "dueDays", label: "Due (days offset)", type: "number", required: true, min: -90, max: 365, default: "0" },
    { name: "sortOrder", label: "Order", type: "number", required: true, min: 0, default: "0" },
    { name: "description", label: "Description", type: "textarea" },
  ],
  columns: [{ key: "kind", header: "Checklist", cell: (r) => <Status value={r.kind === "onboarding" ? "scheduled" : "pending"} /> }, col.main("title", "Task", "description", "title"), col.text("dueDays", "Due (days)"), col.text("sortOrder", "Order", { hideBelow: "md" })],
};

export const announcementsConfig: CrudConfig = {
  queryKey: "announcements",
  title: "Announcements",
  singular: "Announcement",
  description: "Company news shown to every employee in their workspace between the publish and expiry dates.",
  icon: Megaphone,
  path: "announcements",
  managePermission: "announcements:manage",
  defaultSort: { sort: "publishOn", order: "desc" },
  fields: [
    { name: "title", label: "Title", required: true, wide: true },
    { name: "body", label: "Message", type: "textarea", required: true },
    { name: "publishOn", label: "Publish on", type: "date", required: true },
    { name: "expiresOn", label: "Expires on", type: "date" },
    { name: "isPinned", label: "Pin to top", type: "boolean" },
  ],
  columns: [col.main("title", "Announcement", undefined, "title"), col.date("publishOn", "Published", "publishOn"), col.date("expiresOn", "Expires"), col.bool("isPinned", "Pinned")],
};

/* ── Talent ── */

export const vacanciesConfig: CrudConfig = {
  queryKey: "vacancies",
  title: "Vacancies",
  singular: "Vacancy",
  description: "Open positions with their job descriptions. Applications can only be added to open vacancies.",
  icon: Briefcase,
  path: "vacancies",
  managePermission: "recruitment:manage",
  defaultSort: { sort: "createdAt", order: "desc" },
  filters: [{ key: "status", label: "Status", options: opts(["draft", "open", "closed", "filled"]) }],
  fields: [
    { name: "code", label: "Code", type: "code", required: true },
    { name: "title", label: "Job title", required: true },
    { name: "departmentId", label: "Department", type: "ref", ref: { path: "organization/departments", label: named } },
    { name: "designationId", label: "Designation", type: "ref", ref: { path: "organization/designations", label: named } },
    { name: "branchId", label: "Branch", type: "ref", ref: { path: "organization/branches", label: named } },
    { name: "employmentType", label: "Employment type", type: "select", required: true, options: opts(EMPLOYMENT_TYPES), default: "permanent" },
    { name: "openings", label: "Openings", type: "number", required: true, min: 1, default: "1" },
    { name: "closingDate", label: "Closing date", type: "date" },
    { name: "status", label: "Status", type: "select", required: true, options: opts(["draft", "open", "closed", "filled"]), default: "draft" },
    { name: "description", label: "Job description", type: "textarea" },
  ],
  columns: [
    col.code(),
    col.main("title", "Vacancy", "departmentName", "title"),
    col.text("openings", "Openings", { hideBelow: "md" }),
    col.text("applicationCount", "Applications"),
    col.date("closingDate", "Closes", "closingDate"),
    col.status(),
  ],
};

export const applicantsConfig: CrudConfig = {
  queryKey: "applicants",
  title: "Applicants",
  singular: "Applicant",
  description: "Candidate profiles with CVs. One applicant can apply to several vacancies.",
  icon: UserPlus,
  path: "applicants",
  managePermission: "recruitment:manage",
  defaultSort: { sort: "createdAt", order: "desc" },
  fields: [
    { name: "firstName", label: "First name", required: true },
    { name: "lastName", label: "Last name", required: true },
    { name: "email", label: "Email", type: "email", required: true },
    { name: "phone", label: "Phone" },
    { name: "cvFileId", label: "CV", type: "file", purpose: "cv", display: "cvFileName" },
    { name: "notes", label: "Notes", type: "textarea" },
  ],
  columns: [
    { key: "name", header: "Applicant", sortKey: "name", cell: (r) => <div><p className="font-medium">{String(r.firstName)} {String(r.lastName)}</p><p className="text-xs text-muted-foreground">{String(r.email)}</p></div> },
    col.text("phone", "Phone", { hideBelow: "md" }),
    { key: "cv", header: "CV", cell: (r) => (r.cvFileId ? <a className="text-[13px] text-brand-accent hover:underline" onClick={(e) => e.stopPropagation()} href={`/api/files/${r.cvFileId}/content`}>{String(r.cvFileName ?? "CV")}</a> : <span className="text-text-muted">—</span>) },
    col.text("applicationCount", "Applications"),
  ],
};

export const interviewsConfig: CrudConfig = {
  queryKey: "interviews",
  title: "Interviews",
  singular: "Interview",
  description: "Schedule interviews and record evaluations. The interviewer is notified.",
  icon: CalendarDays,
  path: "interviews",
  managePermission: "recruitment:manage",
  defaultSort: { sort: "scheduledAt", order: "asc" },
  filters: [{ key: "status", label: "Status", options: opts(["scheduled", "completed", "cancelled"]) }],
  fields: [
    { name: "applicationId", label: "Application", type: "ref", required: true, createOnly: true, ref: { path: "applications", label: (r) => `${r.applicantName} — ${r.vacancyTitle}` } },
    { name: "scheduledAt", label: "Date & time", type: "datetime", required: true },
    { name: "durationMinutes", label: "Duration (min)", type: "number", required: true, min: 10, max: 480, default: "60" },
    { name: "interviewerId", label: "Interviewer", type: "employee", display: "interviewerName" },
    { name: "mode", label: "Mode", type: "select", required: true, options: opts(["onsite", "video", "phone"]), default: "onsite" },
    { name: "location", label: "Location / link" },
    { name: "status", label: "Status", type: "select", options: opts(["scheduled", "completed", "cancelled"]) },
    { name: "score", label: "Score (1–5)", type: "number", min: 1, max: 5 },
    { name: "recommendation", label: "Recommendation", type: "select", options: opts(["hire", "hold", "reject"]) },
    { name: "feedback", label: "Evaluation", type: "textarea" },
  ],
  toBody: (b, editing) => (editing ? b : Object.fromEntries(Object.entries(b).filter(([k]) => !["status", "score", "recommendation", "feedback"].includes(k)))),
  columns: [
    { key: "when", header: "When", sortKey: "scheduledAt", cell: (r) => <span className="tabular-nums">{new Date(String(r.scheduledAt)).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span> },
    col.main("applicantName", "Candidate", "vacancyTitle"),
    col.text("interviewerName", "Interviewer", { hideBelow: "md" }),
    { key: "mode", header: "Mode", hideBelow: "lg", cell: (r) => label(r.mode as string) },
    { key: "score", header: "Score", cell: (r) => (r.score ? `${r.score}/5` : "—") },
    col.status(),
  ],
};

export const cyclesConfig: CrudConfig = {
  queryKey: "performance-cycles",
  title: "Performance cycles",
  singular: "Cycle",
  description: "Review periods. Launching a cycle creates a review for every active employee with their manager as reviewer.",
  icon: Target,
  path: "performance-cycles",
  managePermission: "performance:manage",
  defaultSort: { sort: "startDate", order: "desc" },
  fields: [
    { name: "name", label: "Name", required: true, wide: true },
    { name: "startDate", label: "Start", type: "date", required: true },
    { name: "endDate", label: "End", type: "date", required: true },
    { name: "status", label: "Status", type: "select", required: true, options: opts(["draft", "active", "closed"]), default: "draft" },
  ],
  rowActions: (r, refresh) => [
    {
      label: "Launch reviews",
      icon: Target,
      hidden: r.status === "closed",
      onSelect: async () => {
        try {
          const res = await api.post<{ created: number }>(`performance-cycles/${r.id}/launch`);
          toast.success(`${res.data.created} review(s) created`);
          refresh();
        } catch (e) {
          toast.error(errorMessage(e));
        }
      },
    },
  ],
  columns: [
    col.main("name", "Cycle", undefined, "name"),
    col.date("startDate", "Start", "startDate"),
    col.date("endDate", "End"),
    { key: "progress", header: "Completed", cell: (r) => <span className="tabular-nums">{String(r.completedCount)} / {String(r.reviewCount)}</span> },
    col.status(),
  ],
};

export const programsConfig: CrudConfig = {
  queryKey: "training-programs",
  title: "Training programs",
  singular: "Program",
  description: "Courses and certifications. Certificates with a validity period get an expiry date and reminders.",
  icon: BookOpen,
  path: "training-programs",
  managePermission: "training:manage",
  defaultSort: { sort: "startDate", order: "desc" },
  filters: [{ key: "status", label: "Status", options: opts(["planned", "ongoing", "completed", "cancelled"]) }],
  fields: [
    { name: "code", label: "Code", type: "code", required: true },
    { name: "title", label: "Title", required: true },
    { name: "provider", label: "Provider" },
    { name: "capacity", label: "Capacity", type: "number", min: 1 },
    { name: "startDate", label: "Start", type: "date" },
    { name: "endDate", label: "End", type: "date" },
    { name: "certificationName", label: "Certification" },
    { name: "certificateValidityMonths", label: "Certificate valid (months)", type: "number", min: 1, max: 240 },
    { name: "status", label: "Status", type: "select", required: true, options: opts(["planned", "ongoing", "completed", "cancelled"]), default: "planned" },
    { name: "description", label: "Description", type: "textarea" },
  ],
  columns: [col.code(), col.main("title", "Program", "provider", "title"), col.date("startDate", "Start", "startDate"), { key: "enrolled", header: "Enrolled", cell: (r) => <span className="tabular-nums">{String(r.enrolledCount)}{r.capacity ? ` / ${r.capacity}` : ""}</span> }, col.status()],
};

/* ── Administration ── */

export const assetCategoriesConfig: CrudConfig = {
  queryKey: "asset-categories",
  title: "Asset categories",
  singular: "Category",
  description: "Groups of company assets.",
  icon: PackageOpen,
  path: "asset-categories",
  managePermission: "assets:manage",
  hasActive: true,
  defaultSort: { sort: "name", order: "asc" },
  fields: [
    { name: "code", label: "Code", type: "code", required: true },
    { name: "name", label: "Name", required: true },
  ],
  columns: [col.code(), col.main("name", "Category", undefined, "name")],
};

export const expenseCategoriesConfig: CrudConfig = {
  queryKey: "expense-categories",
  title: "Expense categories",
  singular: "Category",
  description: "Claim types with optional limits and receipt rules.",
  icon: Receipt,
  path: "expense-categories",
  managePermission: "expenses:manage",
  hasActive: true,
  defaultSort: { sort: "name", order: "asc" },
  fields: [
    { name: "code", label: "Code", type: "code", required: true },
    { name: "name", label: "Name", required: true },
    { name: "maxAmount", label: "Maximum per claim", type: "money", min: 0.01 },
    { name: "requiresReceipt", label: "Receipt required", type: "boolean", default: true },
  ],
  columns: [col.code(), col.main("name", "Category", undefined, "name"), col.money("maxAmount", "Limit"), col.bool("requiresReceipt", "Receipt")],
};

export const ASSET_CONDITIONS = ["new", "good", "fair", "poor", "damaged"];
export const assetFields = [
  { name: "categoryId", label: "Category", type: "ref" as const, required: true, ref: { path: "asset-categories", label: codeNamed } },
  { name: "assetTag", label: "Asset tag", type: "code" as const, required: true },
  { name: "name", label: "Name", required: true, wide: true },
  { name: "serialNumber", label: "Serial number" },
  { name: "purchaseDate", label: "Purchase date", type: "date" as const },
  { name: "purchaseCost", label: "Purchase cost", type: "money" as const, min: 0 },
  { name: "condition", label: "Condition", type: "select" as const, required: true, options: opts(ASSET_CONDITIONS), default: "good" },
  { name: "notes", label: "Notes", type: "textarea" as const },
];

