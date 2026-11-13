import { db, withTransaction, type DbExecutor } from '../../database/knex';
import { PERMISSIONS as P } from '../../shared/constants/permissions';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors/app-error';
import type { AuthContext } from '../../shared/types/auth';
import { toCamel } from '../../shared/utils/case';
import { likeTerm, paginate } from '../../shared/utils/pagination';
import { requireTenantId, tenantScope } from '../../shared/utils/tenant-scope';
import { audit } from '../hr-common/audit';
import { canAccessEmployee, findMyEmployee, tenantToday } from '../hr-common/me';
import { notify, usersWithPermission } from '../notifications/notifications.service';
import { registerApprovalHandler, workflowService } from '../workflow/workflow.service';
import { calendar } from './time.service';

const num = (v: unknown) => Number(v ?? 0);

/** Entitlement accrued by `asOf` (monthly accrual earns 1/12 per completed month, rounded to 0.5). */
export function accrued(entitled: number, accrual: string, year: number, asOf: string): number {
  if (accrual !== 'monthly') return entitled;
  const y = +asOf.slice(0, 4);
  const months = y > year ? 12 : y < year ? 0 : +asOf.slice(5, 7);
  return Math.floor(((entitled * months) / 12) * 2) / 2;
}

interface BalanceRow {
  id: string;
  employee_id: string;
  leave_type_id: string;
  year: number;
  entitled: string;
  carried_forward: string;
  adjustment: string;
  used: string;
  pending: string;
  accrual?: string;
}

/** Applicable policy: latest effective on or before Jan 1 of `year` (or later in that year), type-specific first. */
async function policyFor(
  ex: DbExecutor,
  tenantId: string,
  leaveTypeId: string,
  employmentType: string,
  year: number,
) {
  return tenantScope(ex, 'leave_policies', tenantId)
    .where({ leave_type_id: leaveTypeId })
    .where((q) => q.whereNull('employment_type').orWhere('employment_type', employmentType))
    .where('effective_from', '<=', `${year}-12-31`)
    .orderByRaw('employment_type IS NULL, effective_from DESC')
    .first();
}

export const balances = {
  /** Gets or creates (with policy entitlement + carry-forward) the balance row, locked for update. */
  async ensure(
    ex: DbExecutor,
    tenantId: string,
    employeeId: string,
    leaveTypeId: string,
    year: number,
  ): Promise<BalanceRow & { accrual: string }> {
    const emp = await tenantScope(ex, 'employees', tenantId)
      .where({ id: employeeId })
      .first('employment_type');
    const policy = await policyFor(ex, tenantId, leaveTypeId, emp.employment_type, year);
    const find = () =>
      tenantScope(ex, 'leave_balances', tenantId)
        .where({ employee_id: employeeId, leave_type_id: leaveTypeId, year })
        .forUpdate()
        .first() as Promise<BalanceRow | undefined>;
    let row = await find();
    if (!row) {
      const prev = (await tenantScope(ex, 'leave_balances', tenantId)
        .where({ employee_id: employeeId, leave_type_id: leaveTypeId, year: year - 1 })
        .first()) as BalanceRow | undefined;
      const prevLeft = prev
        ? num(prev.entitled) + num(prev.carried_forward) + num(prev.adjustment) - num(prev.used)
        : 0;
      const carried = Math.max(0, Math.min(prevLeft, num(policy?.carry_forward_max)));
      await ex('leave_balances')
        .insert({
          tenant_id: tenantId,
          employee_id: employeeId,
          leave_type_id: leaveTypeId,
          year,
          entitled: num(policy?.annual_days),
          carried_forward: carried,
        })
        .onConflict(['tenant_id', 'employee_id', 'leave_type_id', 'year'])
        .ignore();
      row = (await find())!;
    }
    return { ...row, accrual: policy?.accrual ?? 'annual' };
  },
  available(b: BalanceRow & { accrual: string }, asOf: string) {
    return (
      accrued(num(b.entitled), b.accrual, b.year, asOf) +
      num(b.carried_forward) +
      num(b.adjustment) -
      num(b.used) -
      num(b.pending)
    );
  },
};

const requestQuery = (tenantId: string) =>
  tenantScope(db, 'leave_requests as r', tenantId)
    .join('employees as e', 'e.id', 'r.employee_id')
    .join('leave_types as t', 't.id', 'r.leave_type_id')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .whereNull('e.deleted_at')
    .select(
      'r.*',
      db.raw(`e.first_name || ' ' || e.last_name as employee_name`),
      'e.employee_number',
      'e.department_id',
      'd.name as department_name',
      't.name as leave_type_name',
      't.color as leave_type_color',
      't.is_paid',
    );

/** Managers see their direct reports; holders of leave:read see everyone; others only themselves. */
async function scopeFor(auth: AuthContext) {
  if (auth.permissions.has(P.LEAVE_READ)) return null;
  const me = await findMyEmployee(auth);
  if (!me) return [] as string[];
  const reports = (await tenantScope(db, 'employees', requireTenantId(auth))
    .where({ manager_id: me.id })
    .pluck('id')) as string[];
  return [me.id, ...reports];
}

export interface ApplyInput {
  employeeId?: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  halfDay?: 'am' | 'pm' | null;
  reason?: string | null;
}

export const leaveService = {
  async list(
    auth: AuthContext,
    q: {
      page: number;
      limit: number;
      status?: string;
      employeeId?: string;
      leaveTypeId?: string;
      departmentId?: string;
      from?: string;
      to?: string;
      search?: string;
    },
  ) {
    const tenantId = requireTenantId(auth);
    const scope = await scopeFor(auth);
    const base = requestQuery(tenantId).modify((b) => {
      if (scope) b.whereIn('r.employee_id', scope);
      if (q.status) b.where('r.status', q.status);
      if (q.employeeId) b.where('r.employee_id', q.employeeId);
      if (q.leaveTypeId) b.where('r.leave_type_id', q.leaveTypeId);
      if (q.departmentId) b.where('e.department_id', q.departmentId);
      if (q.from) b.where('r.end_date', '>=', q.from);
      if (q.to) b.where('r.start_date', '<=', q.to);
      if (q.search)
        b.where((w) =>
          w
            .whereRaw(`(e.first_name || ' ' || e.last_name) ILIKE ?`, [likeTerm(q.search!)])
            .orWhereILike('e.employee_number', likeTerm(q.search!)),
        );
    });
    const { items, meta } = await paginate<Record<string, unknown>>(base, q, {
      column: 'r.start_date',
      order: 'desc',
    });
    return { items: items.map(toCamel), meta };
  },

  async get(auth: AuthContext, id: string) {
    const tenantId = requireTenantId(auth);
    const r = await requestQuery(tenantId).where('r.id', id).first();
    if (!r || !(await canAccessEmployee(auth, r.employee_id, P.LEAVE_READ)))
      throw new NotFoundError('Leave request');
    return {
      ...toCamel(r),
      approval: await workflowService.getForEntity(auth, 'leave_request', id).catch(() => null),
    };
  },

  /** Team / company calendar: live (pending + approved) leave overlapping the range. */
  async calendar(auth: AuthContext, q: { from: string; to: string; departmentId?: string }) {
    const tenantId = requireTenantId(auth);
    const scope = await scopeFor(auth);
    const rows = await requestQuery(tenantId)
      .whereIn('r.status', ['pending', 'approved'])
      .where('r.start_date', '<=', q.to)
      .where('r.end_date', '>=', q.from)
      .modify((b) => {
        if (scope) b.whereIn('r.employee_id', scope);
        if (q.departmentId) b.where('e.department_id', q.departmentId);
      })
      .orderBy('r.start_date');
    return rows.map(toCamel);
  },

  /**
   * Applies for leave. The employee row lock serialises concurrent applications, so overlap and
   * balance checks cannot race; the exclusion constraint backs up full-day overlap in the DB.
   */
  async apply(auth: AuthContext, input: ApplyInput) {
    const tenantId = requireTenantId(auth);
    const me = await findMyEmployee(auth);
    const employeeId = input.employeeId ?? me?.id;
    if (!employeeId) throw new BadRequestError('Choose an employee');
    if (employeeId !== me?.id && !auth.permissions.has(P.LEAVE_CREATE))
      throw new NotFoundError('Employee');
    if (input.endDate < input.startDate)
      throw new BadRequestError('The end date must be on or after the start date');
    if (input.halfDay && input.startDate !== input.endDate)
      throw new BadRequestError('A half day must be a single date');
    // ponytail: requests may not span years; split at Dec 31 if a tenant ever needs cross-year leave.
    if (input.startDate.slice(0, 4) !== input.endDate.slice(0, 4))
      throw new BadRequestError('Split leave that crosses the new year into two requests');

    const id = await withTransaction(async (trx) => {
      const emp = await tenantScope(trx, 'employees', tenantId)
        .whereNull('deleted_at')
        .where({ id: employeeId })
        .forUpdate()
        .first('id', 'status', 'first_name', 'last_name');
      if (!emp) throw new NotFoundError('Employee');
      if (['resigned', 'terminated', 'inactive'].includes(emp.status))
        throw new BadRequestError(`The employee is ${emp.status}`);
      const type = await tenantScope(trx, 'leave_types', tenantId)
        .where({ id: input.leaveTypeId, is_active: true })
        .first();
      if (!type) throw new BadRequestError('Unknown or inactive leave type');
      if (input.halfDay && !type.allow_half_day)
        throw new BadRequestError(`${type.name} cannot be taken as a half day`);

      const clash = await tenantScope(trx, 'leave_requests', tenantId)
        .where({ employee_id: employeeId })
        .whereIn('status', ['pending', 'approved'])
        .where('start_date', '<=', input.endDate)
        .where('end_date', '>=', input.startDate)
        .select('half_day');
      const halfClash =
        input.halfDay &&
        clash.length > 0 &&
        clash.every((c) => c.half_day) &&
        !clash.some((c) => c.half_day === input.halfDay);
      if (clash.length && !halfClash)
        throw new ConflictError('This overlaps another leave request');

      const workDays = await calendar.workingDays(
        tenantId,
        employeeId,
        input.startDate,
        input.endDate,
        trx,
      );
      if (!workDays.length) throw new BadRequestError('The selected dates contain no working days');
      const days = input.halfDay ? 0.5 : workDays.length;

      const year = +input.startDate.slice(0, 4);
      const bal = await balances.ensure(trx, tenantId, employeeId, input.leaveTypeId, year);
      const asOf = input.endDate > `${year}-12-31` ? `${year}-12-31` : input.endDate;
      if (!type.allow_negative && balances.available(bal, asOf) < days)
        throw new BadRequestError(
          `Insufficient ${type.name} balance: ${balances.available(bal, asOf)} day(s) available, ${days} requested`,
        );

      const [row] = await trx('leave_requests')
        .insert({
          tenant_id: tenantId,
          employee_id: employeeId,
          leave_type_id: input.leaveTypeId,
          start_date: input.startDate,
          end_date: input.endDate,
          half_day: input.halfDay ?? null,
          days,
          reason: input.reason ?? null,
          requested_by: auth.userId,
        })
        .returning('id');
      await trx('leave_balances').where({ id: bal.id }).increment('pending', days);
      await workflowService.submit(trx, auth, {
        entityType: 'leave_request',
        entityId: row.id,
        title: `${type.name}: ${emp.first_name} ${emp.last_name}, ${input.startDate}${input.startDate !== input.endDate ? ` to ${input.endDate}` : ''} (${days} day${days === 1 ? '' : 's'})`,
        subjectEmployeeId: employeeId,
      });
      return row.id as string;
    });
    return leaveService.get(auth, id);
  },

  /** Pending: withdraw. Approved: only before it starts (or by HR), restoring the balance. */
  async cancel(auth: AuthContext, id: string, reason: string | null) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const r = await tenantScope(trx, 'leave_requests', tenantId)
        .where({ id })
        .forUpdate()
        .first();
      const me = await findMyEmployee(auth, trx);
      const isHr = auth.permissions.has(P.LEAVE_MANAGE);
      if (!r || (!isHr && r.employee_id !== me?.id)) throw new NotFoundError('Leave request');
      if (!['pending', 'approved'].includes(r.status))
        throw new ConflictError(`This request is already ${r.status}`);
      if (r.status === 'approved' && !isHr && r.start_date <= (await tenantToday(tenantId)))
        throw new ConflictError('Leave that has started can only be cancelled by HR');
      const bal = await balances.ensure(
        trx,
        tenantId,
        r.employee_id,
        r.leave_type_id,
        +r.start_date.slice(0, 4),
      );
      await trx('leave_balances')
        .where({ id: bal.id })
        .decrement(r.status === 'pending' ? 'pending' : 'used', num(r.days));
      await trx('leave_requests')
        .where({ id })
        .update({ status: 'cancelled', decision_comment: reason });
      if (r.status === 'pending') await workflowService.cancel(trx, auth, 'leave_request', id);
      await audit(trx, auth, 'leave.cancel', 'leave_requests', id, { from: r.status, reason });
    });
    return leaveService.get(auth, id);
  },

  async balances(auth: AuthContext, employeeId: string, year: number) {
    const tenantId = requireTenantId(auth);
    if (!(await canAccessEmployee(auth, employeeId, P.LEAVE_READ)))
      throw new NotFoundError('Employee');
    const types = await tenantScope(db, 'leave_types', tenantId)
      .where({ is_active: true })
      .orderBy('name');
    const today = await tenantToday(tenantId);
    const asOf = +today.slice(0, 4) === year ? today : `${year}-12-31`;
    return withTransaction(async (trx) =>
      Promise.all(
        types.map(async (t) => {
          const b = await balances.ensure(trx, tenantId, employeeId, t.id, year);
          return {
            leaveTypeId: t.id,
            leaveTypeName: t.name,
            color: t.color,
            isPaid: t.is_paid,
            year,
            entitled: num(b.entitled),
            accrued: accrued(num(b.entitled), b.accrual, year, asOf),
            carriedForward: num(b.carried_forward),
            adjustment: num(b.adjustment),
            used: num(b.used),
            pending: num(b.pending),
            available: balances.available(b, asOf),
          };
        }),
      ),
    );
  },

  /** Manual balance adjustment (+/−), audited. */
  async adjust(
    auth: AuthContext,
    input: { employeeId: string; leaveTypeId: string; year: number; days: number; reason: string },
  ) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      if (
        !(await tenantScope(trx, 'employees', tenantId).where({ id: input.employeeId }).first('id'))
      )
        throw new NotFoundError('Employee');
      if (
        !(await tenantScope(trx, 'leave_types', tenantId)
          .where({ id: input.leaveTypeId })
          .first('id'))
      )
        throw new BadRequestError('Unknown leave type');
      const b = await balances.ensure(
        trx,
        tenantId,
        input.employeeId,
        input.leaveTypeId,
        input.year,
      );
      await trx('leave_balances').where({ id: b.id }).increment('adjustment', input.days);
      await audit(trx, auth, 'leave.adjust', 'leave_balances', b.id, input);
    });
    return leaveService.balances(auth, input.employeeId, input.year);
  },

  /** Re-applies current policy entitlement to existing balance rows for a year. */
  async recalculateEntitlements(auth: AuthContext, year: number) {
    const tenantId = requireTenantId(auth);
    const rows = await tenantScope(db, 'leave_balances as b', tenantId)
      .join('employees as e', 'e.id', 'b.employee_id')
      .where('b.year', year)
      .select('b.id', 'b.leave_type_id', 'e.employment_type');
    await withTransaction(async (trx) => {
      for (const r of rows) {
        const p = await policyFor(trx, tenantId, r.leave_type_id, r.employment_type, year);
        await trx('leave_balances')
          .where({ id: r.id })
          .update({ entitled: num(p?.annual_days) });
      }
      await audit(trx, auth, 'leave.recalculate', 'leave_balances', null, {
        year,
        rows: rows.length,
      });
    });
    return { updated: rows.length };
  },
};

registerApprovalHandler('leave_request', {
  label: 'Leave request',
  permission: P.LEAVE_APPROVE,
  link: (id) => `/leave?request=${id}`,
  async onDecision(trx, { tenantId, entityId, comment }, decision) {
    const r = await tenantScope(trx, 'leave_requests', tenantId)
      .where({ id: entityId })
      .forUpdate()
      .first();
    if (r.status !== 'pending') return;
    const b = await balances.ensure(
      trx,
      tenantId,
      r.employee_id,
      r.leave_type_id,
      +r.start_date.slice(0, 4),
    );
    await trx('leave_balances').where({ id: b.id }).decrement('pending', num(r.days));
    if (decision === 'approved')
      await trx('leave_balances').where({ id: b.id }).increment('used', num(r.days));
    await trx('leave_requests')
      .where({ id: entityId })
      .update({ status: decision, decision_comment: comment });
    if (decision === 'approved') {
      // Full days already marked absent become on-leave.
      if (!r.half_day)
        await tenantScope(trx, 'attendance_records', tenantId)
          .where({ employee_id: r.employee_id, status: 'absent' })
          .whereBetween('work_date', [r.start_date, r.end_date])
          .update({ status: 'on_leave' });
      const hr = await usersWithPermission(tenantId, P.LEAVE_MANAGE, trx);
      await notify(
        {
          tenantId,
          userIds: hr,
          type: 'leave',
          title: 'Leave approved',
          body: `${r.start_date} to ${r.end_date}`,
          link: '/leave',
          dedupeKey: `leave-approved:${entityId}`,
        },
        trx,
      );
    }
  },
});
