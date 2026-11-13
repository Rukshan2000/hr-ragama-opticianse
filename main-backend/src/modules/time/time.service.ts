import { db, withTransaction, type DbExecutor } from '../../database/knex';
import { PERMISSIONS as P } from '../../shared/constants/permissions';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors/app-error';
import type { AuthContext } from '../../shared/types/auth';
import { toCamel } from '../../shared/utils/case';
import { likeTerm, paginate } from '../../shared/utils/pagination';
import { requireTenantId, tenantScope } from '../../shared/utils/tenant-scope';
import { audit } from '../hr-common/audit';
import { dbGuard } from '../hr-common/crud';
import { findMyEmployee, requireMyEmployee, tenantTimezone } from '../hr-common/me';
import { registerApprovalHandler, workflowService } from '../workflow/workflow.service';
import {
  addDays,
  computeAttendance,
  DEFAULT_POLICY,
  isoWeekday,
  rotationWeek,
  zonedDate,
  type PolicySpec,
  type ShiftSpec,
} from './attendance-calc';

/* ── Calendar resolution (shared with leave and payroll) ───── */

interface EmpCal {
  id: string;
  branch_id: string | null;
  tz: string;
}

export const calendar = {
  async employee(tenantId: string, employeeId: string, ex: DbExecutor = db): Promise<EmpCal> {
    const e = await tenantScope(ex, 'employees as e', tenantId)
      .leftJoin('branches as b', 'b.id', 'e.branch_id')
      .where('e.id', employeeId)
      .whereNull('e.deleted_at')
      .first('e.id', 'e.branch_id', 'b.timezone');
    if (!e) throw new NotFoundError('Employee');
    return { id: e.id, branch_id: e.branch_id, tz: e.timezone ?? (await tenantTimezone(tenantId)) };
  },

  /** Shift for each date in [from, to] (null = day off) from the effective-dated schedule assignment. */
  async shifts(
    tenantId: string,
    employeeId: string,
    from: string,
    to: string,
    ex: DbExecutor = db,
  ) {
    const assignments = await tenantScope(ex, 'employee_schedules as a', tenantId)
      .join('work_schedules as w', 'w.id', 'a.schedule_id')
      .where('a.employee_id', employeeId)
      .where('a.effective_from', '<=', to)
      .where((q) => q.whereNull('a.effective_to').orWhere('a.effective_to', '>=', from))
      .select('a.schedule_id', 'a.effective_from', 'a.effective_to', 'w.rotation_weeks');
    const days = assignments.length
      ? await tenantScope(ex, 'work_schedule_days as d', tenantId)
          .leftJoin('shifts as s', 's.id', 'd.shift_id')
          .whereIn(
            'd.schedule_id',
            assignments.map((a) => a.schedule_id),
          )
          .select(
            'd.schedule_id',
            'd.week_index',
            'd.weekday',
            'd.shift_id',
            's.name',
            's.start_time',
            's.end_time',
            's.break_minutes',
            's.grace_minutes',
            's.early_leave_grace_minutes',
          )
      : [];
    const out = new Map<string, (ShiftSpec & { id: string; name: string }) | null | undefined>();
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const a = assignments.find(
        (x) => x.effective_from <= d && (!x.effective_to || x.effective_to >= d),
      );
      if (!a) {
        out.set(d, undefined); // no schedule assigned
        continue;
      }
      const wk = rotationWeek(a.effective_from, d, a.rotation_weeks);
      const day = days.find(
        (x) =>
          x.schedule_id === a.schedule_id && x.week_index === wk && x.weekday === isoWeekday(d),
      );
      out.set(d, day?.shift_id ? { ...day, id: day.shift_id } : null);
    }
    return out;
  },

  /** Holiday dates in [from, to] for a branch (branch-specific + tenant-wide, recurring expanded). */
  async holidays(
    tenantId: string,
    branchId: string | null,
    from: string,
    to: string,
    ex: DbExecutor = db,
  ) {
    const rows = await tenantScope(ex, 'holidays', tenantId)
      .where((q) =>
        q.whereNull('branch_id').modify((b) => branchId && b.orWhere('branch_id', branchId)),
      )
      .where((q) => q.whereBetween('holiday_date', [from, to]).orWhere('is_recurring', true))
      .select('name', 'holiday_date', 'is_recurring');
    const map = new Map<string, string>();
    for (const h of rows) {
      if (!h.is_recurring) map.set(h.holiday_date, h.name);
      else
        for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
          const d = `${y}${h.holiday_date.slice(4)}`;
          if (d >= from && d <= to && d >= h.holiday_date) map.set(d, h.name);
        }
    }
    return map;
  },

  /** Approved leave per date: 1 for full day, 0.5 for half day. */
  async leaveDays(
    tenantId: string,
    employeeId: string,
    from: string,
    to: string,
    ex: DbExecutor = db,
  ) {
    const rows = await tenantScope(ex, 'leave_requests as r', tenantId)
      .join('leave_types as t', 't.id', 'r.leave_type_id')
      .where({ 'r.employee_id': employeeId, 'r.status': 'approved' })
      .where('r.start_date', '<=', to)
      .where('r.end_date', '>=', from)
      .select('r.start_date', 'r.end_date', 'r.half_day', 't.is_paid');
    const map = new Map<string, { portion: number; paid: boolean }>();
    for (const r of rows)
      for (
        let d = r.start_date > from ? r.start_date : from;
        d <= (r.end_date < to ? r.end_date : to);
        d = addDays(d, 1)
      )
        map.set(d, {
          portion: (map.get(d)?.portion ?? 0) + (r.half_day ? 0.5 : 1),
          paid: r.is_paid,
        });
    return map;
  },

  async policy(tenantId: string, date: string, ex: DbExecutor = db): Promise<PolicySpec> {
    const p = await tenantScope(ex, 'attendance_policies', tenantId)
      .where('effective_from', '<=', date)
      .orderBy('effective_from', 'desc')
      .first();
    return p ?? DEFAULT_POLICY;
  },

  /** Working days in a range: scheduled shift days (Mon–Fri when unscheduled) minus holidays. */
  async workingDays(
    tenantId: string,
    employeeId: string,
    from: string,
    to: string,
    ex: DbExecutor = db,
  ) {
    const e = await calendar.employee(tenantId, employeeId, ex);
    const [shifts, hols] = await Promise.all([
      calendar.shifts(tenantId, employeeId, from, to, ex),
      calendar.holidays(tenantId, e.branch_id, from, to, ex),
    ]);
    const days: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const s = shifts.get(d);
      const works = s === undefined ? isoWeekday(d) <= 5 : s !== null;
      if (works && !hols.has(d)) days.push(d);
    }
    return days;
  },
};

/* ── Work schedules (pattern with days) ───────────────────── */

export interface ScheduleInput {
  name: string;
  rotationWeeks: number;
  description?: string | null;
  isActive?: boolean;
  days: { weekIndex: number; weekday: number; shiftId: string | null }[];
}

export const schedulesService = {
  async list(auth: AuthContext) {
    const tenantId = requireTenantId(auth);
    const [schedules, days, counts] = await Promise.all([
      tenantScope(db, 'work_schedules', tenantId).orderBy('name'),
      tenantScope(db, 'work_schedule_days', tenantId).select(
        'schedule_id',
        'week_index',
        'weekday',
        'shift_id',
      ),
      tenantScope(db, 'employee_schedules', tenantId)
        .where((q) =>
          q.whereNull('effective_to').orWhere('effective_to', '>=', db.raw('CURRENT_DATE')),
        )
        .groupBy('schedule_id')
        .select('schedule_id', db.raw('count(*)::int as n')),
    ]);
    return schedules.map((s) => ({
      ...toCamel(s),
      employeeCount: counts.find((c) => c.schedule_id === s.id)?.n ?? 0,
      days: days
        .filter((d) => d.schedule_id === s.id)
        .map((d) => ({ weekIndex: d.week_index, weekday: d.weekday, shiftId: d.shift_id })),
    }));
  },
  async save(auth: AuthContext, id: string | null, input: ScheduleInput) {
    const tenantId = requireTenantId(auth);
    if (input.days.some((d) => d.weekIndex >= input.rotationWeeks))
      throw new BadRequestError('A day refers to a week outside the rotation');
    const sid = await dbGuard('schedule', () =>
      withTransaction(async (trx) => {
        const row = {
          name: input.name,
          rotation_weeks: input.rotationWeeks,
          description: input.description ?? null,
          is_active: input.isActive ?? true,
        };
        let scheduleId = id;
        if (scheduleId) {
          if (
            !(await tenantScope(trx, 'work_schedules', tenantId)
              .where({ id: scheduleId })
              .update(row))
          )
            throw new NotFoundError('Schedule');
          await tenantScope(trx, 'work_schedule_days', tenantId)
            .where({ schedule_id: scheduleId })
            .delete();
        } else {
          [{ id: scheduleId }] = await trx('work_schedules')
            .insert({ ...row, tenant_id: tenantId })
            .returning('id');
        }
        if (input.days.length)
          await trx('work_schedule_days').insert(
            input.days.map((d) => ({
              tenant_id: tenantId,
              schedule_id: scheduleId,
              week_index: d.weekIndex,
              weekday: d.weekday,
              shift_id: d.shiftId,
            })),
          );
        await audit(
          trx,
          auth,
          id ? 'schedule.update' : 'schedule.create',
          'work_schedules',
          scheduleId,
          input,
        );
        return scheduleId!;
      }),
    );
    return (await schedulesService.list(auth)).find((s) => (s as { id?: string }).id === sid);
  },
  async remove(auth: AuthContext, id: string) {
    await dbGuard(
      'schedule',
      async () => {
        if (
          !(await tenantScope(db, 'work_schedules', requireTenantId(auth)).where({ id }).delete())
        )
          throw new NotFoundError('Schedule');
      },
      true,
    );
  },
};

/* ── Attendance ───────────────────────────────────────────── */

const attendanceQuery = (tenantId: string) =>
  tenantScope(db, 'attendance_records as a', tenantId)
    .join('employees as e', 'e.id', 'a.employee_id')
    .leftJoin('shifts as s', 's.id', 'a.shift_id')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .whereNull('e.deleted_at')
    .select(
      'a.*',
      db.raw(`e.first_name || ' ' || e.last_name as employee_name`),
      'e.employee_number',
      'd.name as department_name',
      's.name as shift_name',
    );

export interface AttendanceFilter {
  page: number;
  limit: number;
  from?: string;
  to?: string;
  employeeId?: string;
  departmentId?: string;
  branchId?: string;
  status?: string;
  search?: string;
}

function applyFilter(
  b: ReturnType<typeof attendanceQuery>,
  q: Omit<AttendanceFilter, 'page' | 'limit'>,
) {
  if (q.from) b.where('a.work_date', '>=', q.from);
  if (q.to) b.where('a.work_date', '<=', q.to);
  if (q.employeeId) b.where('a.employee_id', q.employeeId);
  if (q.departmentId) b.where('e.department_id', q.departmentId);
  if (q.branchId) b.where('e.branch_id', q.branchId);
  if (q.status) b.where('a.status', q.status);
  if (q.search)
    b.where((w) =>
      w
        .whereRaw(`(e.first_name || ' ' || e.last_name) ILIKE ?`, [likeTerm(q.search!)])
        .orWhereILike('e.employee_number', likeTerm(q.search!)),
    );
  return b;
}

/** Recomputes and upserts one day's record. Caller holds the transaction. */
async function writeDay(
  trx: DbExecutor,
  tenantId: string,
  employeeId: string,
  workDate: string,
  input: {
    checkIn: Date | null;
    checkOut: Date | null;
    breakMinutes?: number | null;
    source: string;
    notes?: string | null;
    recordedBy: string | null;
  },
) {
  const e = await calendar.employee(tenantId, employeeId, trx);
  const [shifts, hols, leave, policy] = await Promise.all([
    calendar.shifts(tenantId, employeeId, workDate, workDate, trx),
    calendar.holidays(tenantId, e.branch_id, workDate, workDate, trx),
    calendar.leaveDays(tenantId, employeeId, workDate, workDate, trx),
    calendar.policy(tenantId, workDate, trx),
  ]);
  const shift = shifts.get(workDate) ?? null;
  const result = computeAttendance(
    {
      workDate,
      tz: e.tz,
      shift,
      isHoliday: hols.has(workDate),
      onLeave: (leave.get(workDate)?.portion ?? 0) >= 1,
      policy,
    },
    input.checkIn,
    input.checkOut,
    input.breakMinutes,
  );
  const row = {
    tenant_id: tenantId,
    employee_id: employeeId,
    work_date: workDate,
    shift_id: shift ? (shift as { id: string }).id : null,
    check_in: input.checkIn,
    check_out: input.checkOut,
    source: input.source,
    notes: input.notes ?? null,
    recorded_by: input.recordedBy,
    ...result,
  };
  const [saved] = await trx('attendance_records')
    .insert(row)
    .onConflict(['tenant_id', 'employee_id', 'work_date'])
    .merge()
    .returning('id');
  return saved.id as string;
}

export const attendanceService = {
  async list(auth: AuthContext, q: AttendanceFilter) {
    const tenantId = requireTenantId(auth);
    let scoped = { ...q };
    if (!auth.permissions.has(P.ATTENDANCE_READ))
      scoped = { ...q, employeeId: (await requireMyEmployee(auth)).id };
    const { items, meta } = await paginate<Record<string, unknown>>(
      applyFilter(attendanceQuery(tenantId), scoped),
      q,
      {
        column: 'a.work_date',
        order: 'desc',
      },
    );
    return { items: items.map(toCamel), meta };
  },

  /** Per-employee totals for a range (attendance report). */
  async summary(
    auth: AuthContext,
    q: Omit<AttendanceFilter, 'page' | 'limit'> & { from: string; to: string },
  ) {
    const tenantId = requireTenantId(auth);
    const rows = await applyFilter(
      tenantScope(db, 'attendance_records as a', tenantId)
        .join('employees as e', 'e.id', 'a.employee_id')
        .whereNull('e.deleted_at'),
      q,
    )
      .groupBy('e.id')
      .select(
        'e.id as employeeId',
        db.raw(`e.first_name || ' ' || e.last_name as "employeeName"`),
        'e.employee_number as employeeNumber',
        db.raw(
          `count(*) FILTER (WHERE a.status IN ('present','late','half_day'))::int as "presentDays"`,
        ),
        db.raw(`count(*) FILTER (WHERE a.status = 'late')::int as "lateDays"`),
        db.raw(`count(*) FILTER (WHERE a.status = 'absent')::int as "absentDays"`),
        db.raw(`count(*) FILTER (WHERE a.status = 'half_day')::int as "halfDays"`),
        db.raw(`count(*) FILTER (WHERE a.status = 'on_leave')::int as "leaveDays"`),
        db.raw(`count(*) FILTER (WHERE a.early_leave_minutes > 0)::int as "earlyDepartures"`),
        db.raw(
          `count(*) FILTER (WHERE a.check_in IS NOT NULL AND a.check_out IS NULL)::int as "missingCheckouts"`,
        ),
        db.raw(`COALESCE(sum(a.worked_minutes),0)::int as "workedMinutes"`),
        db.raw(`COALESCE(sum(a.late_minutes),0)::int as "lateMinutes"`),
        db.raw(`COALESCE(sum(a.overtime_minutes),0)::int as "overtimeMinutes"`),
      )
      .orderBy('employeeName');
    return rows;
  },

  /** Admin/manual entry for any employee and date (attendance:manage). */
  async record(
    auth: AuthContext,
    input: {
      employeeId: string;
      workDate: string;
      checkIn: string | null;
      checkOut: string | null;
      breakMinutes?: number | null;
      notes?: string | null;
      source: 'manual' | 'admin' | 'device';
    },
  ) {
    const tenantId = requireTenantId(auth);
    const checkIn = input.checkIn ? new Date(input.checkIn) : null;
    const checkOut = input.checkOut ? new Date(input.checkOut) : null;
    if (checkOut && !checkIn) throw new BadRequestError('A check-out needs a check-in');
    if (checkIn && checkOut && checkOut <= checkIn)
      throw new BadRequestError('Check-out must be after check-in');
    if (checkOut && checkIn && checkOut.getTime() - checkIn.getTime() > 24 * 3_600_000)
      throw new BadRequestError('A single attendance period cannot exceed 24 hours');
    const id = await dbGuard('attendance record', () =>
      withTransaction(async (trx) => {
        await assertNoOverlap(trx, tenantId, input.employeeId, input.workDate, checkIn, checkOut);
        const rid = await writeDay(trx, tenantId, input.employeeId, input.workDate, {
          checkIn,
          checkOut,
          breakMinutes: input.breakMinutes,
          source: input.source,
          notes: input.notes,
          recordedBy: auth.userId,
        });
        await audit(trx, auth, 'attendance.record', 'attendance_records', rid, input);
        return rid;
      }),
    );
    return toCamel((await attendanceQuery(tenantId).where('a.id', id).first())!);
  },

  async remove(auth: AuthContext, id: string) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const n = await tenantScope(trx, 'attendance_records', tenantId).where({ id }).delete();
      if (!n) throw new NotFoundError('Attendance record');
      await audit(trx, auth, 'attendance.delete', 'attendance_records', id, null);
    });
  },

  /** Self check-in: one open period at a time; the work date is today in the branch time zone. */
  async checkIn(auth: AuthContext) {
    const tenantId = requireTenantId(auth);
    const me = await requireMyEmployee(auth);
    return withTransaction(async (trx) => {
      await tenantScope(trx, 'employees', tenantId).where({ id: me.id }).forUpdate().first('id');
      const open = await tenantScope(trx, 'attendance_records', tenantId)
        .where({ employee_id: me.id })
        .whereNotNull('check_in')
        .whereNull('check_out')
        .where('check_in', '>', db.raw(`now() - interval '24 hours'`))
        .first('id');
      if (open) throw new ConflictError('You are already checked in');
      const e = await calendar.employee(tenantId, me.id, trx);
      const now = new Date();
      const workDate = zonedDate(now, e.tz);
      const existing = await tenantScope(trx, 'attendance_records', tenantId)
        .where({ employee_id: me.id, work_date: workDate })
        .first('check_in');
      if (existing?.check_in) throw new ConflictError('You already checked in today');
      await writeDay(trx, tenantId, me.id, workDate, {
        checkIn: now,
        checkOut: null,
        source: 'self',
        recordedBy: auth.userId,
      });
      return { workDate, checkIn: now };
    });
  },

  /** Closes the open period (works across midnight for overnight shifts). */
  async checkOut(auth: AuthContext) {
    const tenantId = requireTenantId(auth);
    const me = await requireMyEmployee(auth);
    return withTransaction(async (trx) => {
      const open = await tenantScope(trx, 'attendance_records', tenantId)
        .where({ employee_id: me.id })
        .whereNotNull('check_in')
        .whereNull('check_out')
        .where('check_in', '>', db.raw(`now() - interval '24 hours'`))
        .orderBy('check_in', 'desc')
        .forUpdate()
        .first();
      if (!open) throw new ConflictError('You are not checked in');
      const now = new Date();
      await writeDay(trx, tenantId, me.id, open.work_date, {
        checkIn: open.check_in,
        checkOut: now,
        source: open.source,
        notes: open.notes,
        recordedBy: auth.userId,
      });
      return { workDate: open.work_date, checkOut: now };
    });
  },

  async today(auth: AuthContext) {
    const tenantId = requireTenantId(auth);
    const me = await findMyEmployee(auth);
    if (!me) return null;
    const e = await calendar.employee(tenantId, me.id);
    const workDate = zonedDate(new Date(), e.tz);
    const shifts = await calendar.shifts(tenantId, me.id, workDate, workDate);
    const rec = await tenantScope(db, 'attendance_records', tenantId)
      .where({ employee_id: me.id })
      .where((q) =>
        q
          .where('work_date', workDate)
          .orWhere((w) =>
            w
              .whereNull('check_out')
              .whereNotNull('check_in')
              .where('check_in', '>', db.raw(`now() - interval '24 hours'`)),
          ),
      )
      .orderBy('work_date', 'desc')
      .first();
    const shift = shifts.get(workDate);
    return {
      workDate,
      timezone: e.tz,
      shift: shift
        ? { name: shift.name, startTime: shift.start_time, endTime: shift.end_time }
        : null,
      record: rec ? toCamel(rec) : null,
    };
  },

  /**
   * Creates 'absent' records for employees scheduled on `date` with no record, no leave and no
   * holiday. Idempotent (skips existing rows).
   */
  async markMissing(tenantId: string, date: string) {
    const employees = await tenantScope(db, 'employees', tenantId)
      .whereNull('deleted_at')
      .whereIn('status', ['probation', 'active', 'on_notice'])
      .where('joining_date', '<=', date)
      .whereNotExists(
        db('attendance_records as a')
          .whereRaw('a.employee_id = employees.id')
          .where('a.work_date', date),
      )
      .pluck('id');
    let created = 0;
    for (const id of employees as string[]) {
      await withTransaction(async (trx) => {
        const r = await writeDay(trx, tenantId, id, date, {
          checkIn: null,
          checkOut: null,
          source: 'admin',
          notes: null,
          recordedBy: null,
        });
        const rec = await trx('attendance_records').where({ id: r }).first('status');
        if (rec.status === 'off') await trx('attendance_records').where({ id: r }).delete();
        else created++;
      });
    }
    return { date, created };
  },

  /** Recomputes stored records in a range (after shift/holiday/policy changes). */
  async recalculate(auth: AuthContext, q: { from: string; to: string; employeeId?: string }) {
    const tenantId = requireTenantId(auth);
    const rows = await tenantScope(db, 'attendance_records', tenantId)
      .whereBetween('work_date', [q.from, q.to])
      .modify((b) => q.employeeId && b.where('employee_id', q.employeeId))
      .select('*');
    for (const r of rows)
      await withTransaction((trx) =>
        writeDay(trx, tenantId, r.employee_id, r.work_date, {
          checkIn: r.check_in,
          checkOut: r.check_out,
          breakMinutes: r.break_minutes || null,
          source: r.source,
          notes: r.notes,
          recordedBy: r.recorded_by,
        }),
      );
    return { updated: rows.length };
  },
};

/** Rejects a period that overlaps another day's period for the same employee. */
async function assertNoOverlap(
  trx: DbExecutor,
  tenantId: string,
  employeeId: string,
  workDate: string,
  checkIn: Date | null,
  checkOut: Date | null,
) {
  if (!checkIn) return;
  const end = checkOut ?? new Date(checkIn.getTime() + 60_000);
  const clash = await tenantScope(trx, 'attendance_records', tenantId)
    .where({ employee_id: employeeId })
    .whereNot('work_date', workDate)
    .whereNotNull('check_in')
    .whereRaw(
      `tstzrange(check_in, COALESCE(check_out, check_in + interval '1 minute')) && tstzrange(?, ?)`,
      [checkIn, end],
    )
    .first('work_date');
  if (clash) throw new ConflictError(`This period overlaps the attendance on ${clash.work_date}`);
}

/* ── Attendance corrections (approval workflow) ───────────── */

export const correctionsService = {
  async list(auth: AuthContext, q: { status?: string; employeeId?: string }) {
    const tenantId = requireTenantId(auth);
    const employeeId = auth.permissions.has(P.ATTENDANCE_READ)
      ? q.employeeId
      : (await requireMyEmployee(auth)).id;
    const rows = await tenantScope(db, 'attendance_corrections as c', tenantId)
      .join('employees as e', 'e.id', 'c.employee_id')
      .modify((b) => {
        if (q.status) b.where('c.status', q.status);
        if (employeeId) b.where('c.employee_id', employeeId);
      })
      .orderBy('c.created_at', 'desc')
      .limit(200)
      .select(
        'c.*',
        db.raw(`e.first_name || ' ' || e.last_name as employee_name`),
        'e.employee_number',
      );
    return rows.map(toCamel);
  },

  async create(
    auth: AuthContext,
    input: {
      employeeId?: string;
      workDate: string;
      checkIn: string;
      checkOut?: string | null;
      reason: string;
    },
  ) {
    const tenantId = requireTenantId(auth);
    const me = await findMyEmployee(auth);
    const employeeId = input.employeeId ?? me?.id;
    if (!employeeId) throw new BadRequestError('Choose an employee');
    if (employeeId !== me?.id && !auth.permissions.has(P.ATTENDANCE_MANAGE))
      throw new NotFoundError('Employee');
    if (input.checkOut && input.checkOut <= input.checkIn)
      throw new BadRequestError('Check-out must be after check-in');
    const e = await calendar.employee(tenantId, employeeId);
    const id = await withTransaction(async (trx) => {
      const pending = await tenantScope(trx, 'attendance_corrections', tenantId)
        .where({ employee_id: employeeId, work_date: input.workDate, status: 'pending' })
        .first('id');
      if (pending) throw new ConflictError('A correction for this day is already pending');
      const [row] = await trx('attendance_corrections')
        .insert({
          tenant_id: tenantId,
          employee_id: employeeId,
          work_date: input.workDate,
          check_in: input.checkIn,
          check_out: input.checkOut ?? null,
          reason: input.reason,
          requested_by: auth.userId,
        })
        .returning('id');
      await workflowService.submit(trx, auth, {
        entityType: 'attendance_correction',
        entityId: row.id,
        title: `Attendance correction for ${input.workDate}`,
        subjectEmployeeId: e.id,
      });
      return row.id as string;
    });
    return { id };
  },

  async cancel(auth: AuthContext, id: string) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const c = await tenantScope(trx, 'attendance_corrections', tenantId)
        .where({ id })
        .forUpdate()
        .first();
      if (!c || (c.requested_by !== auth.userId && !auth.permissions.has(P.ATTENDANCE_MANAGE)))
        throw new NotFoundError('Correction');
      if (c.status !== 'pending')
        throw new ConflictError('Only pending corrections can be cancelled');
      await trx('attendance_corrections').where({ id }).update({ status: 'cancelled' });
      await workflowService.cancel(trx, auth, 'attendance_correction', id);
    });
  },
};

registerApprovalHandler('attendance_correction', {
  label: 'Attendance correction',
  permission: P.ATTENDANCE_APPROVE,
  link: () => '/attendance?tab=corrections',
  async onDecision(trx, { tenantId, entityId }, decision) {
    const c = await tenantScope(trx, 'attendance_corrections', tenantId)
      .where({ id: entityId })
      .forUpdate()
      .first();
    await trx('attendance_corrections').where({ id: entityId }).update({ status: decision });
    if (decision === 'approved') {
      await assertNoOverlap(trx, tenantId, c.employee_id, c.work_date, c.check_in, c.check_out);
      await writeDay(trx, tenantId, c.employee_id, c.work_date, {
        checkIn: c.check_in,
        checkOut: c.check_out,
        source: 'correction',
        notes: c.reason,
        recordedBy: c.requested_by,
      });
    }
  },
});
