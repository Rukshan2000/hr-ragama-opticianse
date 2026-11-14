import { db, withTransaction, type DbExecutor } from '../../database/knex';
import { PERMISSIONS as P } from '../../shared/constants/permissions';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors/app-error';
import type { AuthContext } from '../../shared/types/auth';
import { toCamel } from '../../shared/utils/case';
import { renderPdf, type PdfLine } from '../../shared/utils/pdf';
import { requireTenantId, tenantScope } from '../../shared/utils/tenant-scope';
import { audit } from '../hr-common/audit';
import { accountingService } from '../integrations/accounting.service';
import { dbGuard } from '../hr-common/crud';
import { findMyEmployee } from '../hr-common/me';
import { notify } from '../notifications/notifications.service';
import { addDays, daysBetween } from '../time/attendance-calc';
import { calendar } from '../time/time.service';
import { calculatePayslip, type PayLine, type PayrollPolicy } from './payroll-calc';

const num = (v: unknown) => Number(v ?? 0);
const monthRange = (year: number, month: number) => {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const next =
    month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return { from, to: addDays(next, -1) };
};

/* ── Salary revisions ─────────────────────────────────────── */

export interface SalaryInput {
  employeeId: string;
  effectiveFrom: string;
  basicSalary: number;
  reason?: string | null;
  items: { componentId: string; amount: number }[];
}

export const salaryService = {
  async history(auth: AuthContext, employeeId: string) {
    const tenantId = requireTenantId(auth);
    const revisions = await tenantScope(db, 'employee_salaries as s', tenantId)
      .leftJoin('users as u', 'u.id', 's.created_by')
      .where('s.employee_id', employeeId)
      .orderBy('s.effective_from', 'desc')
      .select('s.*', 'u.name as created_by_name');
    const items = revisions.length
      ? await tenantScope(db, 'employee_salary_items as i', tenantId)
          .join('salary_components as c', 'c.id', 'i.component_id')
          .whereIn(
            'i.salary_id',
            revisions.map((r) => r.id),
          )
          .select('i.salary_id', 'i.component_id', 'i.amount', 'c.name', 'c.kind')
      : [];
    return revisions.map((r) => ({
      ...toCamel(r),
      basicSalary: num(r.basic_salary),
      items: items
        .filter((i) => i.salary_id === r.id)
        .map((i) => ({
          componentId: i.component_id,
          name: i.name,
          kind: i.kind,
          amount: num(i.amount),
        })),
    }));
  },

  /** Current salary per employee (latest revision effective today) for the salary list page. */
  async current(auth: AuthContext, q: { search?: string; departmentId?: string }) {
    const tenantId = requireTenantId(auth);
    return tenantScope(db, 'employees as e', tenantId)
      .whereNull('e.deleted_at')
      .whereNotIn('e.status', ['resigned', 'terminated'])
      .leftJoin('departments as d', 'd.id', 'e.department_id')
      .leftJoin(
        db.raw(
          `LATERAL (SELECT s.id, s.basic_salary, s.effective_from FROM employee_salaries s WHERE s.employee_id = e.id AND s.effective_from <= CURRENT_DATE ORDER BY s.effective_from DESC LIMIT 1) cur ON true`,
        ),
      )
      .modify((b) => {
        if (q.departmentId) b.where('e.department_id', q.departmentId);
        if (q.search)
          b.where((w) =>
            w
              .whereRaw(`(e.first_name || ' ' || e.last_name) ILIKE ?`, [`%${q.search}%`])
              .orWhereILike('e.employee_number', `%${q.search}%`),
          );
      })
      .orderBy('e.first_name')
      .select(
        'e.id as employeeId',
        db.raw(`e.first_name || ' ' || e.last_name as "employeeName"`),
        'e.employee_number as employeeNumber',
        'd.name as departmentName',
        'cur.basic_salary as basicSalary',
        'cur.effective_from as effectiveFrom',
        db.raw(
          `(SELECT COALESCE(sum(i.amount),0) FROM employee_salary_items i JOIN salary_components c ON c.id = i.component_id WHERE i.salary_id = cur.id AND c.kind = 'earning') as "allowances"`,
        ),
      );
  },

  async revise(auth: AuthContext, input: SalaryInput) {
    const tenantId = requireTenantId(auth);
    if (new Set(input.items.map((i) => i.componentId)).size !== input.items.length)
      throw new BadRequestError('Each component may appear once');
    await dbGuard('salary revision', () =>
      withTransaction(async (trx) => {
        if (
          !(await tenantScope(trx, 'employees', tenantId)
            .whereNull('deleted_at')
            .where({ id: input.employeeId })
            .first('id'))
        )
          throw new NotFoundError('Employee');
        const [s] = await trx('employee_salaries')
          .insert({
            tenant_id: tenantId,
            employee_id: input.employeeId,
            effective_from: input.effectiveFrom,
            basic_salary: input.basicSalary,
            reason: input.reason ?? null,
            created_by: auth.userId,
          })
          .returning('id');
        if (input.items.length)
          await trx('employee_salary_items').insert(
            input.items.map((i) => ({
              tenant_id: tenantId,
              salary_id: s.id,
              component_id: i.componentId,
              amount: i.amount,
            })),
          );
        await audit(trx, auth, 'salary.revise', 'employee_salaries', s.id, input);
      }),
    );
    return salaryService.history(auth, input.employeeId);
  },

  async removeRevision(auth: AuthContext, id: string) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const s = await tenantScope(trx, 'employee_salaries', tenantId)
        .where({ id })
        .forUpdate()
        .first();
      if (!s) throw new NotFoundError('Salary revision');
      const used = await tenantScope(trx, 'payroll_runs', tenantId)
        .whereIn('status', ['approved', 'locked'])
        .whereRaw(`make_date(year, month, 1) + interval '1 month' - interval '1 day' >= ?::date`, [
          s.effective_from,
        ])
        .first('id');
      if (used)
        throw new ConflictError(
          'This revision was used by a finalized payroll. Add a new revision instead',
        );
      await tenantScope(trx, 'employee_salaries', tenantId).where({ id }).delete();
      await audit(trx, auth, 'salary.delete', 'employee_salaries', id, null);
    });
  },
};

/* ── Payroll runs ─────────────────────────────────────────── */

async function policyFor(ex: DbExecutor, tenantId: string, date: string) {
  const p = await tenantScope(ex, 'payroll_policies', tenantId)
    .where('effective_from', '<=', date)
    .orderBy('effective_from', 'desc')
    .first();
  if (!p)
    throw new BadRequestError(
      'No payroll policy is effective for this period. Configure EPF/ETF/APIT rates first',
    );
  const policy: PayrollPolicy & { id: string } = {
    id: p.id,
    epf_employee_rate: num(p.epf_employee_rate),
    epf_employer_rate: num(p.epf_employer_rate),
    etf_rate: num(p.etf_rate),
    overtime_multiplier: num(p.overtime_multiplier),
    working_days_per_month: p.working_days_per_month,
    working_hours_per_day: num(p.working_hours_per_day),
    apit_brackets: p.apit_brackets,
  };
  return policy;
}

const runDto = (r: Record<string, unknown>) => ({
  ...toCamel(r),
  totalGross: num(r.total_gross),
  totalNet: num(r.total_net),
  totalEmployerCost: num(r.total_employer_cost),
});

const payslipDto = (p: Record<string, unknown>) => {
  const o = toCamel(p) as Record<string, unknown>;
  for (const k of [
    'basicSalary',
    'overtimeHours',
    'overtimePay',
    'unpaidDays',
    'unpaidLeaveDeduction',
    'grossPay',
    'epfEmployee',
    'epfEmployer',
    'etf',
    'apit',
    'loanDeduction',
    'totalDeductions',
    'netPay',
  ])
    o[k] = num(o[k]);
  return o;
};

const payslipQuery = (tenantId: string) =>
  tenantScope(db, 'payslips as p', tenantId)
    .join('employees as e', 'e.id', 'p.employee_id')
    .join('payroll_runs as r', 'r.id', 'p.run_id')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .leftJoin('designations as g', 'g.id', 'e.designation_id')
    .select(
      'p.*',
      db.raw(`e.first_name || ' ' || e.last_name as employee_name`),
      'e.employee_number',
      'd.name as department_name',
      'g.name as designation_name',
      'r.year',
      'r.month',
      'r.status as run_status',
    );

export const payrollService = {
  async listRuns(auth: AuthContext, year?: number) {
    const rows = await tenantScope(db, 'payroll_runs as r', requireTenantId(auth))
      .leftJoin('users as u', 'u.id', 'r.approved_by')
      .modify((b) => year && b.where('r.year', year))
      .orderBy([
        { column: 'r.year', order: 'desc' },
        { column: 'r.month', order: 'desc' },
      ])
      .select('r.*', 'u.name as approved_by_name');
    return rows.map(runDto);
  },

  async getRun(auth: AuthContext, id: string) {
    const tenantId = requireTenantId(auth);
    const r = await tenantScope(db, 'payroll_runs as r', tenantId)
      .leftJoin('users as u', 'u.id', 'r.approved_by')
      .where('r.id', id)
      .first('r.*', 'u.name as approved_by_name');
    if (!r) throw new NotFoundError('Payroll run');
    const slips = await payslipQuery(tenantId).where('p.run_id', id).orderBy('e.first_name');
    return { ...runDto(r), payslips: slips.map(payslipDto) };
  },

  async createRun(auth: AuthContext, year: number, month: number) {
    const tenantId = requireTenantId(auth);
    const row = await dbGuard('payroll run', () =>
      withTransaction(async (trx) => {
        const [r] = await trx('payroll_runs')
          .insert({ tenant_id: tenantId, year, month })
          .returning('id');
        await audit(trx, auth, 'payroll.create', 'payroll_runs', r.id, { year, month });
        return r.id as string;
      }),
    );
    return payrollService.getRun(auth, row);
  },

  /**
   * (Re)calculates a draft/calculated run. Finalized runs are never recalculated; corrections go
   * through payroll adjustments in a later period.
   */
  async calculate(auth: AuthContext, runId: string) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const run = await tenantScope(trx, 'payroll_runs', tenantId)
        .where({ id: runId })
        .forUpdate()
        .first();
      if (!run) throw new NotFoundError('Payroll run');
      if (!['draft', 'calculated'].includes(run.status))
        throw new ConflictError(
          'This payroll is finalized and cannot be recalculated. Record an adjustment in a later period',
        );
      const { from, to } = monthRange(run.year, run.month);
      const policy = await policyFor(trx, tenantId, to);
      await tenantScope(trx, 'payslips', tenantId).where({ run_id: runId }).delete();

      const employees = await tenantScope(trx, 'employees', tenantId)
        .whereNull('deleted_at')
        .where('joining_date', '<=', to)
        .where((q) =>
          q
            .whereNotIn('status', ['resigned', 'terminated'])
            .orWhere((w) => w.where('status', 'resigned').where('resignation_date', '>=', from))
            .orWhere((w) => w.where('status', 'terminated').where('termination_date', '>=', from)),
        )
        .select('id', 'joining_date', 'status', 'resignation_date', 'termination_date');

      const totals = { gross: 0, net: 0, employer: 0, count: 0 };
      const monthDays = daysBetween(from, to) + 1;
      for (const e of employees) {
        const salary = await tenantScope(trx, 'employee_salaries', tenantId)
          .where({ employee_id: e.id })
          .where('effective_from', '<=', to)
          .orderBy('effective_from', 'desc')
          .first();
        if (!salary) continue; // no salary configured: not on payroll
        const items = await tenantScope(trx, 'employee_salary_items as i', tenantId)
          .join('salary_components as c', 'c.id', 'i.component_id')
          .where('i.salary_id', salary.id)
          .select('c.code', 'c.name', 'c.kind', 'c.is_taxable', 'c.is_epf_applicable', 'i.amount');
        const adjustments = await tenantScope(trx, 'payroll_adjustments', tenantId).where({
          employee_id: e.id,
          year: run.year,
          month: run.month,
        });
        const lines: PayLine[] = [
          ...items.map((i) => ({
            label: i.name,
            code: i.code,
            kind: i.kind,
            amount: num(i.amount),
            taxable: i.is_taxable,
            epf: i.is_epf_applicable,
          })),
          ...adjustments.map((a) => ({
            label: a.label,
            code: a.kind === 'earning' ? 'ADJ-EARN' : 'ADJ-DED',
            kind: a.kind,
            amount: num(a.amount),
            taxable: a.is_taxable,
            epf: a.is_epf_applicable,
          })),
        ];

        // Attendance-based: overtime minutes; unpaid leave and absences on working days.
        const att = await tenantScope(trx, 'attendance_records', tenantId)
          .where({ employee_id: e.id })
          .whereBetween('work_date', [from, to])
          .select(
            db.raw('COALESCE(sum(overtime_minutes),0)::int as ot'),
            db.raw(`count(*) FILTER (WHERE status = 'absent')::int as absent`),
          )
          .first();
        const leave = await calendar.leaveDays(tenantId, e.id, from, to, trx);
        const workDays = new Set(await calendar.workingDays(tenantId, e.id, from, to, trx));
        let unpaidLeave = 0;
        for (const [d, l] of leave) if (!l.paid && workDays.has(d)) unpaidLeave += l.portion;

        const end = e.termination_date ?? e.resignation_date;
        const start = e.joining_date > from ? e.joining_date : from;
        const last = end && end < to ? end : to;
        const proration = Math.max(0, daysBetween(start, last) + 1) / monthDays;

        const loans = await tenantScope(trx, 'employee_loans', tenantId)
          .where({ employee_id: e.id, status: 'active' })
          .where('start_date', '<=', to);
        const loanDeduction = loans.reduce(
          (s, l) => s + Math.min(num(l.installment), num(l.balance)),
          0,
        );

        const slip = calculatePayslip(policy, {
          basic: num(salary.basic_salary),
          lines,
          overtimeMinutes: att?.ot ?? 0,
          unpaidDays: unpaidLeave + (att?.absent ?? 0),
          loanDeduction,
          proration,
        });
        await trx('payslips').insert({
          tenant_id: tenantId,
          run_id: runId,
          employee_id: e.id,
          ...slip,
          earnings: JSON.stringify(slip.earnings),
          deductions: JSON.stringify(slip.deductions),
        });
        totals.gross += slip.gross_pay;
        totals.net += slip.net_pay;
        totals.employer += slip.gross_pay + slip.epf_employer + slip.etf;
        totals.count++;
      }
      await trx('payroll_runs')
        .where({ id: runId })
        .update({
          status: 'calculated',
          policy_id: policy.id,
          total_gross: totals.gross.toFixed(2),
          total_net: totals.net.toFixed(2),
          total_employer_cost: totals.employer.toFixed(2),
          employee_count: totals.count,
          calculated_at: trx.fn.now(),
        });
      await audit(trx, auth, 'payroll.calculate', 'payroll_runs', runId, {
        employees: totals.count,
      });
    });
    return payrollService.getRun(auth, runId);
  },

  /** calculated → approved (finalized): payslips become immutable, loans are recovered, staff notified. */
  async approve(auth: AuthContext, runId: string) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const run = await tenantScope(trx, 'payroll_runs', tenantId)
        .where({ id: runId })
        .forUpdate()
        .first();
      if (!run) throw new NotFoundError('Payroll run');
      if (run.status !== 'calculated')
        throw new ConflictError(
          run.status === 'draft'
            ? 'Calculate the payroll before approving it'
            : `This payroll is already ${run.status}`,
        );
      const slips = await tenantScope(trx, 'payslips as p', tenantId)
        .join('employees as e', 'e.id', 'p.employee_id')
        .where('p.run_id', runId)
        .select('p.employee_id', 'p.loan_deduction', 'e.user_id');
      for (const s of slips) {
        let left = num(s.loan_deduction);
        if (!left) continue;
        const loans = await tenantScope(trx, 'employee_loans', tenantId)
          .where({ employee_id: s.employee_id, status: 'active' })
          .orderBy('start_date')
          .forUpdate();
        for (const l of loans) {
          const take = Math.min(left, num(l.installment), num(l.balance));
          if (take <= 0) continue;
          const balance = Math.round((num(l.balance) - take) * 100) / 100;
          await trx('employee_loans')
            .where({ id: l.id })
            .update({ balance, status: balance <= 0 ? 'settled' : 'active' });
          left -= take;
        }
      }
      await trx('payroll_runs')
        .where({ id: runId })
        .update({ status: 'approved', approved_by: auth.userId, approved_at: trx.fn.now() });
      await audit(trx, auth, 'payroll.approve', 'payroll_runs', runId, null);
      const period = `${run.year}-${String(run.month).padStart(2, '0')}`;
      await notify(
        {
          tenantId,
          userIds: slips.map((s) => s.user_id),
          type: 'payroll',
          title: `Your payslip for ${period} is available`,
          link: '/me?tab=payslips',
          dedupeKey: `payslip:${runId}`,
        },
        trx,
      );
    });
    return payrollService.getRun(auth, runId);
  },

  async lock(auth: AuthContext, runId: string) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const run = await tenantScope(trx, 'payroll_runs', tenantId)
        .where({ id: runId })
        .forUpdate()
        .first();
      if (!run) throw new NotFoundError('Payroll run');
      if (run.status !== 'approved')
        throw new ConflictError('Only approved payrolls can be locked');
      await trx('payroll_runs')
        .where({ id: runId })
        .update({ status: 'locked', locked_at: trx.fn.now() });
      await audit(trx, auth, 'payroll.lock', 'payroll_runs', runId, null);
    });
    // Hand the run to accounting. A failure is recorded on the run and can be retried;
    // it never undoes the lock.
    if (accountingService.enabled())
      await accountingService.sendRun(tenantId, runId).catch(() => undefined);
    return payrollService.getRun(auth, runId);
  },

  async removeRun(auth: AuthContext, runId: string) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const run = await tenantScope(trx, 'payroll_runs', tenantId)
        .where({ id: runId })
        .forUpdate()
        .first();
      if (!run) throw new NotFoundError('Payroll run');
      if (!['draft', 'calculated'].includes(run.status))
        throw new ConflictError('Finalized payrolls cannot be deleted');
      await tenantScope(trx, 'payroll_runs', tenantId).where({ id: runId }).delete();
      await audit(trx, auth, 'payroll.delete', 'payroll_runs', runId, {
        year: run.year,
        month: run.month,
      });
    });
  },

  /** Payslip visible to payroll:read, or to the employee once the run is finalized. */
  async payslip(auth: AuthContext, id: string) {
    const tenantId = requireTenantId(auth);
    const p = await payslipQuery(tenantId).where('p.id', id).first();
    if (!p) throw new NotFoundError('Payslip');
    if (!auth.permissions.has(P.PAYROLL_READ)) {
      const me = await findMyEmployee(auth);
      if (me?.id !== p.employee_id || !['approved', 'locked'].includes(p.run_status))
        throw new NotFoundError('Payslip');
    }
    return payslipDto(p);
  },

  async myPayslips(auth: AuthContext) {
    const me = await findMyEmployee(auth);
    if (!me) return [];
    const rows = await payslipQuery(requireTenantId(auth))
      .where('p.employee_id', me.id)
      .whereIn('r.status', ['approved', 'locked'])
      .orderBy([
        { column: 'r.year', order: 'desc' },
        { column: 'r.month', order: 'desc' },
      ]);
    return rows.map(payslipDto);
  },

  async payslipPdf(auth: AuthContext, id: string) {
    const p = (await payrollService.payslip(auth, id)) as Record<string, unknown> & {
      earnings: { label: string; amount: number }[];
      deductions: { label: string; amount: number }[];
    };
    const tenant = await db('tenants')
      .where({ id: requireTenantId(auth) })
      .first('name');
    const settings = await db('tenant_settings')
      .where({ tenant_id: requireTenantId(auth) })
      .first('currency');
    const cur = settings?.currency ?? 'LKR';
    const m = (n: unknown) =>
      `${cur} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const period = new Date(Date.UTC(p.year as number, (p.month as number) - 1, 1)).toLocaleString(
      'en-US',
      { month: 'long', year: 'numeric', timeZone: 'UTC' },
    );
    const lines: PdfLine[] = [
      { text: String(tenant?.name ?? ''), size: 16, bold: true },
      { text: `Payslip - ${period}`, size: 12, gap: 2 },
      { rule: true, text: '', gap: 6 },
      { text: `Employee: ${p.employeeName} (${p.employeeNumber})`, gap: 4 },
      {
        text: `Department: ${p.departmentName ?? '-'}`,
        right: `Designation: ${p.designationName ?? '-'}`,
      },
      { rule: true, text: '', gap: 6 },
      { text: 'Earnings', bold: true, size: 11, gap: 4 },
      { text: 'Basic salary', right: m(p.basicSalary) },
      ...(Number(p.unpaidLeaveDeduction)
        ? [
            {
              text: `Unpaid leave / absence (${p.unpaidDays} d)`,
              right: `- ${m(p.unpaidLeaveDeduction)}`,
            },
          ]
        : []),
      ...p.earnings.map((e) => ({ text: e.label, right: m(e.amount) })),
      { text: 'Gross pay', right: m(p.grossPay), bold: true },
      { text: 'Deductions', bold: true, size: 11, gap: 8 },
      ...p.deductions.map((d) => ({ text: d.label, right: m(d.amount) })),
      { text: 'Total deductions', right: m(p.totalDeductions), bold: true },
      { rule: true, text: '', gap: 6 },
      { text: 'NET PAY', right: m(p.netPay), bold: true, size: 13, gap: 2 },
      { rule: true, text: '', gap: 2 },
      { text: 'Employer contributions', bold: true, size: 11, gap: 8 },
      { text: 'EPF (employer)', right: m(p.epfEmployer) },
      { text: 'ETF', right: m(p.etf) },
      { text: 'This is a system-generated payslip.', size: 8, gap: 24 },
    ];
    return {
      pdf: renderPdf(lines),
      filename: `payslip-${p.employeeNumber}-${p.year}-${String(p.month).padStart(2, '0')}.pdf`,
    };
  },

  /** Payroll register for reports (finalized runs only unless payroll:manage). */
  async register(auth: AuthContext, year: number, month: number) {
    const tenantId = requireTenantId(auth);
    const rows = await payslipQuery(tenantId)
      .where({ 'r.year': year, 'r.month': month })
      .orderBy('e.first_name');
    return rows.map(payslipDto);
  },
};
