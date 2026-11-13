import type { Knex } from 'knex';
import { db } from '../../database/knex';
import { PERMISSIONS as P, type Permission } from '../../shared/constants/permissions';
import { ForbiddenError } from '../../shared/errors/app-error';
import type { AuthContext } from '../../shared/types/auth';
import { requireTenantId, tenantScope } from '../../shared/utils/tenant-scope';
import { tenantToday } from '../hr-common/me';
import { attendanceService } from '../time/time.service';
import { workflowService } from '../workflow/workflow.service';

const has = (auth: AuthContext, p: Permission) => auth.permissions.has(p);

/* ── Dashboard: every section is computed only if the user holds its permission ── */

export const dashboardService = {
  async get(auth: AuthContext) {
    const tenantId = requireTenantId(auth);
    const today = await tenantToday(tenantId);
    const monthStart = `${today.slice(0, 7)}-01`;
    const emp = () => tenantScope(db, 'employees', tenantId).whereNull('deleted_at');
    const out: Record<string, unknown> = {
      today,
      pendingApprovals: await workflowService.pendingCount(auth),
    };

    if (has(auth, P.EMPLOYEES_READ)) {
      const [counts, byDept, byStatus, joiners, birthdays] = await Promise.all([
        emp()
          .select(
            db.raw(`count(*) FILTER (WHERE status NOT IN ('resigned','terminated'))::int as total`),
            db.raw(`count(*) FILTER (WHERE status = 'active')::int as active`),
            db.raw(
              `count(*) FILTER (WHERE status IN ('onboarding','probation'))::int as onboarding`,
            ),
            db.raw(`count(*) FILTER (WHERE joining_date >= ?::date)::int as new_joiners`, [
              monthStart,
            ]),
          )
          .first(),
        tenantScope(db, 'employees as e', tenantId)
          .whereNull('e.deleted_at')
          .whereNotIn('e.status', ['resigned', 'terminated'])
          .leftJoin('departments as d', 'd.id', 'e.department_id')
          .groupBy('d.name')
          .select(
            db.raw(`COALESCE(d.name, 'Unassigned') as label`),
            db.raw('count(*)::int as value'),
          )
          .orderBy('value', 'desc'),
        emp().groupBy('status').select('status as label', db.raw('count(*)::int as value')),
        emp()
          .where('joining_date', '>=', db.raw(`?::date - 30`, [today]))
          .orderBy('joining_date', 'desc')
          .limit(5)
          .select(
            'id',
            db.raw(`first_name || ' ' || last_name as name`),
            'joining_date as joiningDate',
          ),
        emp()
          .whereNotIn('status', ['resigned', 'terminated'])
          .whereNotNull('date_of_birth')
          .select(
            'id',
            db.raw(`first_name || ' ' || last_name as name`),
            'date_of_birth as dateOfBirth',
          ),
      ]);
      // ponytail: birthdays filtered in memory (one row per live employee); fine to tens of thousands.
      const md = (d: string) => d.slice(5);
      const horizon = new Date(`${today}T00:00:00Z`);
      horizon.setUTCDate(horizon.getUTCDate() + 30);
      const end = horizon.toISOString().slice(0, 10);
      out.headcount = {
        total: counts.total,
        active: counts.active,
        onboarding: counts.onboarding,
        newJoiners: counts.new_joiners,
        byDepartment: byDept,
        byStatus,
      };
      out.recentJoiners = joiners;
      out.upcomingBirthdays = birthdays
        .map((b) => ({
          ...b,
          nextDate: `${md(b.dateOfBirth) >= md(today) ? today.slice(0, 4) : +today.slice(0, 4) + 1}-${md(b.dateOfBirth)}`,
        }))
        .filter((b) => b.nextDate <= end)
        .sort((a, b) => a.nextDate.localeCompare(b.nextDate))
        .slice(0, 6);
    }

    if (has(auth, P.ATTENDANCE_READ)) {
      const att = await tenantScope(db, 'attendance_records', tenantId)
        .where('work_date', today)
        .select(
          db.raw(`count(*) FILTER (WHERE status IN ('present','late','half_day'))::int as present`),
          db.raw(`count(*) FILTER (WHERE status = 'late')::int as late`),
          db.raw(`count(*) FILTER (WHERE status = 'absent')::int as absent`),
          db.raw(
            `count(*) FILTER (WHERE check_in IS NOT NULL AND check_out IS NULL)::int as checked_in`,
          ),
        )
        .first();
      const week = await tenantScope(db, 'attendance_records', tenantId)
        .whereBetween('work_date', [db.raw(`?::date - 13`, [today]), today])
        .groupBy('work_date')
        .orderBy('work_date')
        .select(
          'work_date as date',
          db.raw(`count(*) FILTER (WHERE status IN ('present','late','half_day'))::int as present`),
          db.raw(`count(*) FILTER (WHERE status = 'late')::int as late`),
          db.raw(`count(*) FILTER (WHERE status = 'absent')::int as absent`),
        );
      out.attendance = { today: att, trend: week };
    }

    if (has(auth, P.LEAVE_READ)) {
      out.onLeaveToday = await tenantScope(db, 'leave_requests as r', tenantId)
        .join('employees as e', 'e.id', 'r.employee_id')
        .join('leave_types as t', 't.id', 'r.leave_type_id')
        .where('r.status', 'approved')
        .where('r.start_date', '<=', today)
        .where('r.end_date', '>=', today)
        .select(
          'e.id',
          db.raw(`e.first_name || ' ' || e.last_name as name`),
          't.name as leaveType',
          'r.end_date as until',
        );
    }

    if (has(auth, P.CONTRACTS_READ)) {
      out.expiringContracts = await tenantScope(db, 'employment_contracts as c', tenantId)
        .join('employees as e', 'e.id', 'c.employee_id')
        .where('c.status', 'active')
        .whereNull('e.deleted_at')
        .whereRaw('c.end_date BETWEEN ?::date AND ?::date + 60', [today, today])
        .orderBy('c.end_date')
        .limit(8)
        .select(
          'c.id',
          'c.contract_number as contractNumber',
          'c.end_date as endDate',
          db.raw(`e.first_name || ' ' || e.last_name as name`),
        );
    }

    if (has(auth, P.PAYROLL_READ)) {
      out.payroll = await tenantScope(db, 'payroll_runs', tenantId)
        .orderBy([
          { column: 'year', order: 'desc' },
          { column: 'month', order: 'desc' },
        ])
        .limit(6)
        .select(
          'id',
          'year',
          'month',
          'status',
          'total_net as totalNet',
          'employee_count as employeeCount',
        );
    }

    if (has(auth, P.AUDIT_READ) || has(auth, P.EMPLOYEES_READ)) {
      out.recentActivity = await tenantScope(db, 'audit_logs as a', tenantId)
        .leftJoin('users as u', 'u.id', 'a.actor_id')
        .modify(
          (b) =>
            !has(auth, P.AUDIT_READ) &&
            b.whereNotIn('a.entity_type', [
              'payroll_runs',
              'employee_salaries',
              'payroll_policies',
              'payroll_adjustments',
              'employee_loans',
            ]),
        )
        .orderBy('a.created_at', 'desc')
        .limit(10)
        .select(
          'a.id',
          'a.action',
          'a.entity_type as entityType',
          'a.created_at as createdAt',
          'u.name as actorName',
        );
    }
    return out;
  },
};

/* ── Reports ── */

export interface ReportQuery {
  from?: string;
  to?: string;
  branchId?: string;
  departmentId?: string;
  employeeId?: string;
  year?: number;
  month?: number;
}
type Col = { key: string; label: string };
interface Report {
  title: string;
  permission: Permission;
  columns: Col[];
  rows: (auth: AuthContext, q: ReportQuery) => Promise<Record<string, unknown>[]>;
}

const empFilter =
  (q: ReportQuery, alias = 'e') =>
  (b: Knex.QueryBuilder) => {
    if (q.branchId) b.where(`${alias}.branch_id`, q.branchId);
    if (q.departmentId) b.where(`${alias}.department_id`, q.departmentId);
    if (q.employeeId) b.where(`${alias}.id`, q.employeeId);
  };
const fullName = (a = 'e') => db.raw(`${a}.first_name || ' ' || ${a}.last_name as employee`);

export const REPORTS: Record<string, Report> = {
  employees: {
    title: 'Employee directory',
    permission: P.REPORTS_READ,
    columns: [
      { key: 'employee_number', label: 'No.' },
      { key: 'employee', label: 'Employee' },
      { key: 'email', label: 'Email' },
      { key: 'department', label: 'Department' },
      { key: 'designation', label: 'Designation' },
      { key: 'branch', label: 'Branch' },
      { key: 'employment_type', label: 'Type' },
      { key: 'status', label: 'Status' },
      { key: 'joining_date', label: 'Joined' },
    ],
    rows: (auth, q) =>
      tenantScope(db, 'employees as e', requireTenantId(auth))
        .whereNull('e.deleted_at')
        .leftJoin('departments as d', 'd.id', 'e.department_id')
        .leftJoin('designations as g', 'g.id', 'e.designation_id')
        .leftJoin('branches as b', 'b.id', 'e.branch_id')
        .modify(empFilter(q))
        .modify((b) => {
          if (q.from) b.where('e.joining_date', '>=', q.from);
          if (q.to) b.where('e.joining_date', '<=', q.to);
        })
        .orderBy('e.employee_number')
        .select(
          'e.employee_number',
          fullName(),
          'e.email',
          'd.name as department',
          'g.name as designation',
          'b.name as branch',
          'e.employment_type',
          'e.status',
          'e.joining_date',
        ),
  },
  attendance: {
    title: 'Attendance summary',
    permission: P.ATTENDANCE_READ,
    columns: [
      { key: 'employeeNumber', label: 'No.' },
      { key: 'employeeName', label: 'Employee' },
      { key: 'presentDays', label: 'Present' },
      { key: 'lateDays', label: 'Late' },
      { key: 'absentDays', label: 'Absent' },
      { key: 'halfDays', label: 'Half days' },
      { key: 'leaveDays', label: 'On leave' },
      { key: 'earlyDepartures', label: 'Early departures' },
      { key: 'missingCheckouts', label: 'Missing check-outs' },
      { key: 'workedHours', label: 'Worked (h)' },
      { key: 'overtimeHours', label: 'Overtime (h)' },
    ],
    rows: async (auth, q) => {
      const today = await tenantToday(requireTenantId(auth));
      const rows = await attendanceService.summary(auth, {
        from: q.from ?? `${today.slice(0, 7)}-01`,
        to: q.to ?? today,
        branchId: q.branchId,
        departmentId: q.departmentId,
        employeeId: q.employeeId,
      });
      return rows.map((r) => ({
        ...r,
        workedHours: (r.workedMinutes / 60).toFixed(1),
        overtimeHours: (r.overtimeMinutes / 60).toFixed(1),
      }));
    },
  },
  leave: {
    title: 'Leave report',
    permission: P.LEAVE_READ,
    columns: [
      { key: 'employee_number', label: 'No.' },
      { key: 'employee', label: 'Employee' },
      { key: 'leave_type', label: 'Leave type' },
      { key: 'start_date', label: 'From' },
      { key: 'end_date', label: 'To' },
      { key: 'days', label: 'Days' },
      { key: 'status', label: 'Status' },
    ],
    rows: (auth, q) =>
      tenantScope(db, 'leave_requests as r', requireTenantId(auth))
        .join('employees as e', 'e.id', 'r.employee_id')
        .join('leave_types as t', 't.id', 'r.leave_type_id')
        .modify(empFilter(q))
        .modify((b) => {
          if (q.from) b.where('r.end_date', '>=', q.from);
          if (q.to) b.where('r.start_date', '<=', q.to);
        })
        .orderBy('r.start_date', 'desc')
        .select(
          'e.employee_number',
          fullName(),
          't.name as leave_type',
          'r.start_date',
          'r.end_date',
          'r.days',
          'r.status',
        ),
  },
  payroll: {
    title: 'Payroll register',
    permission: P.PAYROLL_READ,
    columns: [
      { key: 'employee_number', label: 'No.' },
      { key: 'employee', label: 'Employee' },
      { key: 'basic_salary', label: 'Basic' },
      { key: 'overtime_pay', label: 'Overtime' },
      { key: 'unpaid_leave_deduction', label: 'Unpaid leave' },
      { key: 'gross_pay', label: 'Gross' },
      { key: 'epf_employee', label: 'EPF (employee)' },
      { key: 'epf_employer', label: 'EPF (employer)' },
      { key: 'etf', label: 'ETF' },
      { key: 'apit', label: 'APIT' },
      { key: 'total_deductions', label: 'Deductions' },
      { key: 'net_pay', label: 'Net pay' },
    ],
    rows: (auth, q) => {
      const today = new Date();
      return tenantScope(db, 'payslips as p', requireTenantId(auth))
        .join('payroll_runs as r', 'r.id', 'p.run_id')
        .join('employees as e', 'e.id', 'p.employee_id')
        .where({
          'r.year': q.year ?? today.getFullYear(),
          'r.month': q.month ?? today.getMonth() + 1,
        })
        .modify(empFilter(q))
        .orderBy('e.employee_number')
        .select(
          'e.employee_number',
          fullName(),
          'p.basic_salary',
          'p.overtime_pay',
          'p.unpaid_leave_deduction',
          'p.gross_pay',
          'p.epf_employee',
          'p.epf_employer',
          'p.etf',
          'p.apit',
          'p.total_deductions',
          'p.net_pay',
        );
    },
  },
  holidays: {
    title: 'Holiday calendar',
    permission: P.REPORTS_READ,
    columns: [
      { key: 'holiday_date', label: 'Date' },
      { key: 'name', label: 'Holiday' },
      { key: 'type', label: 'Type' },
      { key: 'branch', label: 'Branch' },
      { key: 'is_recurring', label: 'Recurring' },
    ],
    rows: (auth, q) =>
      tenantScope(db, 'holidays as h', requireTenantId(auth))
        .leftJoin('branches as b', 'b.id', 'h.branch_id')
        .modify((b) => {
          if (q.from) b.where('h.holiday_date', '>=', q.from);
          if (q.to) b.where('h.holiday_date', '<=', q.to);
          if (q.branchId)
            b.where((w) => w.whereNull('h.branch_id').orWhere('h.branch_id', q.branchId));
        })
        .orderBy('h.holiday_date')
        .select(
          'h.holiday_date',
          'h.name',
          'h.type',
          db.raw(`COALESCE(b.name, 'All branches') as branch`),
          'h.is_recurring',
        ),
  },
  assets: {
    title: 'Asset register',
    permission: P.ASSETS_READ,
    columns: [
      { key: 'asset_tag', label: 'Tag' },
      { key: 'name', label: 'Asset' },
      { key: 'category', label: 'Category' },
      { key: 'status', label: 'Status' },
      { key: 'condition', label: 'Condition' },
      { key: 'employee', label: 'Assigned to' },
      { key: 'assigned_on', label: 'Since' },
      { key: 'purchase_cost', label: 'Cost' },
    ],
    rows: (auth) =>
      tenantScope(db, 'assets as a', requireTenantId(auth))
        .join('asset_categories as c', 'c.id', 'a.category_id')
        .leftJoin('asset_assignments as h', function () {
          this.on('h.asset_id', 'a.id').andOnNull('h.returned_on');
        })
        .leftJoin('employees as e', 'e.id', 'h.employee_id')
        .orderBy('a.asset_tag')
        .select(
          'a.asset_tag',
          'a.name',
          'c.name as category',
          'a.status',
          'a.condition',
          fullName(),
          'h.assigned_on',
          'a.purchase_cost',
        ),
  },
  expenses: {
    title: 'Expense claims',
    permission: P.EXPENSES_READ,
    columns: [
      { key: 'expense_date', label: 'Date' },
      { key: 'employee', label: 'Employee' },
      { key: 'category', label: 'Category' },
      { key: 'description', label: 'Description' },
      { key: 'amount', label: 'Amount' },
      { key: 'status', label: 'Status' },
      { key: 'reimbursed_on', label: 'Reimbursed' },
    ],
    rows: (auth, q) =>
      tenantScope(db, 'expense_claims as x', requireTenantId(auth))
        .join('employees as e', 'e.id', 'x.employee_id')
        .join('expense_categories as c', 'c.id', 'x.category_id')
        .modify(empFilter(q))
        .modify((b) => {
          if (q.from) b.where('x.expense_date', '>=', q.from);
          if (q.to) b.where('x.expense_date', '<=', q.to);
        })
        .orderBy('x.expense_date', 'desc')
        .select(
          'x.expense_date',
          fullName(),
          'c.name as category',
          'x.description',
          'x.amount',
          'x.status',
          'x.reimbursed_on',
        ),
  },
  exits: {
    title: 'Exit report',
    permission: P.EXIT_READ,
    columns: [
      { key: 'employee', label: 'Employee' },
      { key: 'exit_type', label: 'Type' },
      { key: 'notice_date', label: 'Notice' },
      { key: 'last_working_day', label: 'Last day' },
      { key: 'status', label: 'Status' },
      { key: 'settlement_net', label: 'Settlement' },
      { key: 'reason', label: 'Reason' },
    ],
    rows: (auth, q) =>
      tenantScope(db, 'exit_cases as x', requireTenantId(auth))
        .join('employees as e', 'e.id', 'x.employee_id')
        .modify(empFilter(q))
        .modify((b) => {
          if (q.from) b.where('x.last_working_day', '>=', q.from);
          if (q.to) b.where('x.last_working_day', '<=', q.to);
        })
        .orderBy('x.last_working_day', 'desc')
        .select(
          fullName(),
          'x.exit_type',
          'x.notice_date',
          'x.last_working_day',
          'x.status',
          'x.settlement_net',
          'x.reason',
        ),
  },
  recruitment: {
    title: 'Recruitment report',
    permission: P.RECRUITMENT_READ,
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'title', label: 'Vacancy' },
      { key: 'status', label: 'Status' },
      { key: 'openings', label: 'Openings' },
      { key: 'applications', label: 'Applications' },
      { key: 'interviewing', label: 'Interviewing' },
      { key: 'offered', label: 'Offered' },
      { key: 'hired', label: 'Hired' },
    ],
    rows: (auth) =>
      tenantScope(db, 'vacancies as v', requireTenantId(auth))
        .leftJoin('job_applications as a', 'a.vacancy_id', 'v.id')
        .groupBy('v.id')
        .orderBy('v.created_at', 'desc')
        .select(
          'v.code',
          'v.title',
          'v.status',
          'v.openings',
          db.raw('count(a.id)::int as applications'),
          db.raw(`count(a.id) FILTER (WHERE a.stage = 'interview')::int as interviewing`),
          db.raw(`count(a.id) FILTER (WHERE a.stage = 'offered')::int as offered`),
          db.raw(`count(a.id) FILTER (WHERE a.stage = 'hired')::int as hired`),
        ),
  },
  training: {
    title: 'Training & certifications',
    permission: P.TRAINING_READ,
    columns: [
      { key: 'employee', label: 'Employee' },
      { key: 'program', label: 'Program' },
      { key: 'status', label: 'Status' },
      { key: 'completed_on', label: 'Completed' },
      { key: 'score', label: 'Score' },
      { key: 'certificate_expires_on', label: 'Certificate expires' },
    ],
    rows: (auth, q) =>
      tenantScope(db, 'training_enrollments as t', requireTenantId(auth))
        .join('employees as e', 'e.id', 't.employee_id')
        .join('training_programs as p', 'p.id', 't.program_id')
        .modify(empFilter(q))
        .orderBy('p.title')
        .select(
          fullName(),
          'p.title as program',
          't.status',
          't.completed_on',
          't.score',
          't.certificate_expires_on',
        ),
  },
};

export async function runReport(auth: AuthContext, type: string, q: ReportQuery) {
  const r = REPORTS[type]!;
  if (!has(auth, r.permission) || !has(auth, P.REPORTS_READ)) throw new ForbiddenError();
  const rows = await r.rows(auth, q);
  return { title: r.title, columns: r.columns, rows: rows.slice(0, 20_000) };
}

export function availableReports(auth: AuthContext) {
  if (!has(auth, P.REPORTS_READ)) return [];
  return Object.entries(REPORTS)
    .filter(([, r]) => has(auth, r.permission))
    .map(([type, r]) => ({ type, title: r.title }));
}

/* ── Export encoders ── */

const cell = (v: unknown) =>
  v === null || v === undefined
    ? ''
    : v instanceof Date
      ? v.toISOString()
      : typeof v === 'boolean'
        ? v
          ? 'Yes'
          : 'No'
        : String(v);

/** RFC 4180 CSV with a BOM (Excel opens UTF-8 correctly) and formula-injection guard. */
export function toCsv(columns: Col[], rows: Record<string, unknown>[]) {
  const q = (s: string) => {
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [
    columns.map((c) => q(c.label)).join(','),
    ...rows.map((r) => columns.map((c) => q(cell(r[c.key]))).join(',')),
  ];
  return '﻿' + lines.join('\r\n');
}

/**
 * Excel export as SpreadsheetML 2003 (.xls). Opens in Excel/LibreOffice/Numbers without a zip/xlsx
 * dependency. ponytail: Excel shows a format notice on open; switch to a real .xlsx writer if that
 * matters to users.
 */
export function toSpreadsheetXml(title: string, columns: Col[], rows: Record<string, unknown>[]) {
  const x = (s: string) =>
    s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
  const c = (v: unknown) => {
    const s = cell(v);
    return typeof v === 'number' || (/^-?\d+(\.\d+)?$/.test(s) && s.length < 15 && !/^0\d/.test(s))
      ? `<Cell><Data ss:Type="Number">${s}</Data></Cell>`
      : `<Cell><Data ss:Type="String">${x(s)}</Data></Cell>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="h"><Font ss:Bold="1"/></Style></Styles>
<Worksheet ss:Name="${x(title.slice(0, 31))}"><Table>
<Row>${columns.map((col) => `<Cell ss:StyleID="h"><Data ss:Type="String">${x(col.label)}</Data></Cell>`).join('')}</Row>
${rows.map((r) => `<Row>${columns.map((col) => c(r[col.key])).join('')}</Row>`).join('\n')}
</Table></Worksheet></Workbook>`;
}
