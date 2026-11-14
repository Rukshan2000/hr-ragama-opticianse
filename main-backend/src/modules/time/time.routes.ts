import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../shared/constants/permissions';
import { NotFoundError } from '../../shared/errors/app-error';
import { sendSuccess } from '../../shared/utils/response';
import { requireTenantId } from '../../shared/utils/tenant-scope';
import { authenticate, requirePermissions } from '../auth/auth.guard';
import {
  boolQuery,
  code,
  color,
  crudResource,
  employeeJoin,
  idParams,
  isoDate,
  name,
  patchOf,
  text,
} from '../hr-common/crud';
import { leaveService } from './leave.service';
import { canAccessEmployee } from '../hr-common/me';
import { attendanceService, calendar, correctionsService, schedulesService } from './time.service';

const tags = ['Time & attendance'];
const ltags = ['Leave'];
const security = [{ bearerAuth: [] }];
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Use HH:MM');
const mins = (max: number) => z.number().int().min(0).max(max);
const instant = z.iso.datetime({ offset: true });
const page = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
};

/* ── Master data via the CRUD factory ── */

const shiftBody = z.object({
  code: code.optional(),
  name: name(100),
  startTime: time,
  endTime: time,
  breakMinutes: mins(600).default(60),
  graceMinutes: mins(240).default(10),
  earlyLeaveGraceMinutes: mins(240).default(0),
  color,
  isActive: z.boolean().default(true),
});
const shifts = crudResource({
  table: 'shifts',
  codePrefix: 'SH',
  label: 'Shift',
  tag: 'Time & attendance',
  read: P.ORGANIZATION_READ,
  manage: P.SHIFTS_MANAGE,
  create: shiftBody.refine((b) => b.startTime !== b.endTime, {
    message: 'Start and end cannot be equal',
    path: ['endTime'],
  }),
  patch: patchOf(shiftBody),
  filters: { isActive: { column: 'x.is_active', schema: boolQuery } },
  search: ['x.name', 'x.code'],
  sort: { name: 'x.name', code: 'x.code', startTime: 'x.start_time' },
  defaultSort: 'startTime',
});

const assignmentBody = z
  .object({
    employeeId: z.uuid(),
    scheduleId: z.uuid(),
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullish(),
  })
  .refine((b) => !b.effectiveTo || b.effectiveTo >= b.effectiveFrom, {
    message: 'End must be on or after start',
    path: ['effectiveTo'],
  });
const scheduleAssignments = crudResource({
  table: 'employee_schedules',
  label: 'Schedule assignment',
  tag: 'Time & attendance',
  read: P.ATTENDANCE_READ,
  manage: P.SHIFTS_MANAGE,
  create: assignmentBody,
  patch: patchOf(
    z.object({ scheduleId: z.uuid(), effectiveFrom: isoDate, effectiveTo: isoDate.nullable() }),
  ),
  filters: {
    employeeId: { column: 'x.employee_id', schema: z.uuid() },
    scheduleId: { column: 'x.schedule_id', schema: z.uuid() },
  },
  search: ['employee.first_name', 'employee.last_name', 'employee.employee_number'],
  sort: { effectiveFrom: 'x.effective_from', employee: 'employee.first_name' },
  defaultSort: 'effectiveFrom',
  defaultOrder: 'desc',
  select: (q) =>
    employeeJoin()(q)
      .leftJoin('work_schedules as w', 'w.id', 'x.schedule_id')
      .select('w.name as schedule_name'),
  audited: true,
});

const policyBody = z.object({
  effectiveFrom: isoDate,
  overtimeThresholdMinutes: mins(600).default(30),
  halfDayMinutes: mins(1440).default(240),
  countWeekendAsOvertime: z.boolean().default(true),
});
const attendancePolicies = crudResource({
  table: 'attendance_policies',
  label: 'Attendance policy',
  tag: 'Time & attendance',
  read: P.ATTENDANCE_READ,
  manage: P.ATTENDANCE_MANAGE,
  create: policyBody,
  patch: patchOf(policyBody),
  sort: { effectiveFrom: 'x.effective_from' },
  defaultSort: 'effectiveFrom',
  defaultOrder: 'desc',
  audited: true,
});

const holidayBody = z.object({
  name: name(150),
  holidayDate: isoDate,
  type: z.enum(['public', 'company']).default('public'),
  branchId: z.uuid().nullish(),
  isRecurring: z.boolean().default(false),
  description: text(500),
});
const holidays = crudResource({
  table: 'holidays',
  label: 'Holiday',
  tag: 'Time & attendance',
  read: P.ORGANIZATION_READ,
  manage: P.HOLIDAYS_MANAGE,
  create: holidayBody,
  patch: patchOf(holidayBody),
  filters: {
    type: { column: 'x.type', schema: z.enum(['public', 'company']) },
    branchId: { column: 'x.branch_id', schema: z.uuid() },
  },
  search: ['x.name'],
  sort: { holidayDate: 'x.holiday_date', name: 'x.name' },
  defaultSort: 'holidayDate',
  select: (q) => q.leftJoin('branches as b', 'b.id', 'x.branch_id').select('b.name as branch_name'),
});

const leaveTypeBody = z.object({
  code: code.optional(),
  name: name(100),
  isPaid: z.boolean().default(true),
  allowHalfDay: z.boolean().default(true),
  allowNegative: z.boolean().default(false),
  color,
  isActive: z.boolean().default(true),
});
const leaveTypes = crudResource({
  table: 'leave_types',
  codePrefix: 'LT',
  label: 'Leave type',
  tag: 'Leave',
  read: P.SELF_SERVICE,
  manage: P.LEAVE_MANAGE,
  create: leaveTypeBody,
  patch: patchOf(leaveTypeBody),
  filters: { isActive: { column: 'x.is_active', schema: boolQuery } },
  search: ['x.name', 'x.code'],
  sort: { name: 'x.name', code: 'x.code' },
  defaultSort: 'name',
});

const EMPLOYMENT_TYPES = ['permanent', 'temporary', 'contract', 'internship'] as const;
const leavePolicyBody = z.object({
  leaveTypeId: z.uuid(),
  employmentType: z.enum(EMPLOYMENT_TYPES).nullish(),
  annualDays: z.number().min(0).max(365).multipleOf(0.5),
  accrual: z.enum(['annual', 'monthly']).default('annual'),
  carryForwardMax: z.number().min(0).max(365).multipleOf(0.5).default(0),
  effectiveFrom: isoDate,
});
const leavePolicies = crudResource({
  table: 'leave_policies',
  label: 'Leave policy',
  tag: 'Leave',
  read: P.LEAVE_READ,
  manage: P.LEAVE_MANAGE,
  create: leavePolicyBody,
  patch: patchOf(leavePolicyBody),
  filters: { leaveTypeId: { column: 'x.leave_type_id', schema: z.uuid() } },
  sort: { effectiveFrom: 'x.effective_from', leaveType: 't.name' },
  defaultSort: 'leaveType',
  select: (q) =>
    q.join('leave_types as t', 't.id', 'x.leave_type_id').select('t.name as leave_type_name'),
  audited: true,
});

const range = z
  .object({ from: isoDate, to: isoDate })
  .refine((b) => b.to >= b.from, { message: 'End must be on or after start', path: ['to'] })
  .refine((b) => (Date.parse(b.to) - Date.parse(b.from)) / 86_400_000 <= 400, {
    message: 'Range too long (max ~13 months)',
    path: ['to'],
  });

export const timeRoutes: FastifyPluginAsyncZod = async (app) => {
  shifts.register(app, '/shifts');
  scheduleAssignments.register(app, '/schedule-assignments');
  attendancePolicies.register(app, '/attendance-policies');
  holidays.register(app, '/holidays');

  // Holiday calendar with recurring dates expanded (for a branch or all).
  app.get(
    '/holidays-calendar',
    {
      preHandler: authenticate,
      schema: {
        tags,
        security,
        querystring: z.object({
          year: z.coerce.number().int().min(2000).max(2100),
          branchId: z.uuid().optional(),
        }),
      },
    },
    async (req, reply) => {
      const map = await calendar.holidays(
        requireTenantId(req.auth),
        req.query.branchId ?? null,
        `${req.query.year}-01-01`,
        `${req.query.year}-12-31`,
      );
      return sendSuccess(
        reply,
        [...map.entries()].sort().map(([date, name]) => ({ date, name })),
      );
    },
  );

  // Work schedules (pattern + days)
  const scheduleBody = z.object({
    name: name(100),
    rotationWeeks: z.number().int().min(1).max(8).default(1),
    description: text(500),
    isActive: z.boolean().default(true),
    days: z
      .array(
        z.object({
          weekIndex: z.number().int().min(0).max(7),
          weekday: z.number().int().min(1).max(7),
          shiftId: z.uuid().nullable(),
        }),
      )
      .max(56),
  });
  const manageShifts = requirePermissions(P.SHIFTS_MANAGE);
  app.get(
    '/work-schedules',
    { preHandler: requirePermissions(P.ORGANIZATION_READ), schema: { tags, security } },
    async (req, reply) => sendSuccess(reply, await schedulesService.list(req.auth!)),
  );
  app.post(
    '/work-schedules',
    { preHandler: manageShifts, schema: { tags, security, body: scheduleBody } },
    async (req, reply) =>
      sendSuccess(reply, await schedulesService.save(req.auth!, null, req.body), {
        statusCode: 201,
        message: 'Schedule created',
      }),
  );
  app.put(
    '/work-schedules/:id',
    { preHandler: manageShifts, schema: { tags, security, params: idParams, body: scheduleBody } },
    async (req, reply) =>
      sendSuccess(reply, await schedulesService.save(req.auth!, req.params.id, req.body), {
        message: 'Schedule saved',
      }),
  );
  app.delete(
    '/work-schedules/:id',
    { preHandler: manageShifts, schema: { tags, security, params: idParams } },
    async (req, reply) => {
      await schedulesService.remove(req.auth!, req.params.id);
      return sendSuccess(reply, null, { message: 'Schedule deleted' });
    },
  );

  // Employee schedule view (own, managed, or attendance:read)
  app.get(
    '/employees/:id/schedule',
    { preHandler: authenticate, schema: { tags, security, params: idParams, querystring: range } },
    async (req, reply) => {
      const tenantId = requireTenantId(req.auth);
      if (!(await canAccessEmployee(req.auth!, req.params.id, P.ATTENDANCE_READ)))
        throw new NotFoundError('Employee');
      const e = await calendar.employee(tenantId, req.params.id);
      const [s, h, l] = await Promise.all([
        calendar.shifts(tenantId, req.params.id, req.query.from, req.query.to),
        calendar.holidays(tenantId, e.branch_id, req.query.from, req.query.to),
        calendar.leaveDays(tenantId, req.params.id, req.query.from, req.query.to),
      ]);
      return sendSuccess(
        reply,
        [...s.entries()].map(([date, shift]) => ({
          date,
          shift: shift
            ? { name: shift.name, startTime: shift.start_time, endTime: shift.end_time }
            : null,
          scheduled: shift !== undefined,
          holiday: h.get(date) ?? null,
          leave: l.get(date)?.portion ?? 0,
        })),
      );
    },
  );

  // Attendance
  const attendanceFilter = z.object({
    ...page,
    from: isoDate.optional(),
    to: isoDate.optional(),
    employeeId: z.uuid().optional(),
    departmentId: z.uuid().optional(),
    branchId: z.uuid().optional(),
    status: z
      .enum(['present', 'late', 'half_day', 'absent', 'on_leave', 'holiday', 'off'])
      .optional(),
    search: z.string().trim().min(1).max(100).optional(),
  });
  app.get(
    '/attendance',
    { preHandler: authenticate, schema: { tags, security, querystring: attendanceFilter } },
    async (req, reply) => {
      const { items, meta } = await attendanceService.list(req.auth!, req.query);
      return sendSuccess(reply, items, { meta });
    },
  );
  app.get(
    '/attendance/summary',
    {
      preHandler: requirePermissions(P.ATTENDANCE_READ),
      schema: {
        tags,
        security,
        querystring: attendanceFilter
          .omit({ page: true, limit: true })
          .extend({ from: isoDate, to: isoDate }),
      },
    },
    async (req, reply) => sendSuccess(reply, await attendanceService.summary(req.auth!, req.query)),
  );
  app.get(
    '/attendance/today',
    { preHandler: authenticate, schema: { tags, security } },
    async (req, reply) => sendSuccess(reply, await attendanceService.today(req.auth!)),
  );
  app.post(
    '/attendance',
    {
      preHandler: requirePermissions(P.ATTENDANCE_MANAGE),
      schema: {
        tags,
        security,
        summary: 'Manual / admin / device entry (upserts the day)',
        body: z.object({
          employeeId: z.uuid(),
          workDate: isoDate,
          checkIn: instant.nullable(),
          checkOut: instant.nullable(),
          breakMinutes: mins(600).nullish(),
          notes: text(500),
          source: z.enum(['manual', 'admin', 'device']).default('admin'),
        }),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await attendanceService.record(req.auth!, req.body), {
        message: 'Attendance saved',
      }),
  );
  app.delete(
    '/attendance/:id',
    {
      preHandler: requirePermissions(P.ATTENDANCE_MANAGE),
      schema: { tags, security, params: idParams },
    },
    async (req, reply) => {
      await attendanceService.remove(req.auth!, req.params.id);
      return sendSuccess(reply, null, { message: 'Attendance deleted' });
    },
  );
  const self = requirePermissions(P.SELF_SERVICE);
  app.post(
    '/attendance/check-in',
    { preHandler: self, schema: { tags, security } },
    async (req, reply) =>
      sendSuccess(reply, await attendanceService.checkIn(req.auth!), { message: 'Checked in' }),
  );
  app.post(
    '/attendance/check-out',
    { preHandler: self, schema: { tags, security } },
    async (req, reply) =>
      sendSuccess(reply, await attendanceService.checkOut(req.auth!), { message: 'Checked out' }),
  );
  app.post(
    '/attendance/mark-missing',
    {
      preHandler: requirePermissions(P.ATTENDANCE_MANAGE),
      schema: { tags, security, body: z.object({ date: isoDate }) },
    },
    async (req, reply) =>
      sendSuccess(
        reply,
        await attendanceService.markMissing(requireTenantId(req.auth), req.body.date),
        { message: 'Missing attendance marked' },
      ),
  );
  app.post(
    '/attendance/recalculate',
    {
      preHandler: requirePermissions(P.ATTENDANCE_MANAGE),
      schema: { tags, security, body: range.and(z.object({ employeeId: z.uuid().optional() })) },
    },
    async (req, reply) =>
      sendSuccess(reply, await attendanceService.recalculate(req.auth!, req.body), {
        message: 'Attendance recalculated',
      }),
  );

  // Corrections (approval workflow)
  app.get(
    '/attendance-corrections',
    {
      preHandler: authenticate,
      schema: {
        tags,
        security,
        querystring: z.object({
          status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
          employeeId: z.uuid().optional(),
        }),
      },
    },
    async (req, reply) => sendSuccess(reply, await correctionsService.list(req.auth!, req.query)),
  );
  app.post(
    '/attendance-corrections',
    {
      preHandler: authenticate,
      schema: {
        tags,
        security,
        body: z.object({
          employeeId: z.uuid().optional(),
          workDate: isoDate,
          checkIn: instant,
          checkOut: instant.nullish(),
          reason: z.string().trim().min(3).max(500),
        }),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await correctionsService.create(req.auth!, req.body), {
        statusCode: 201,
        message: 'Correction submitted',
      }),
  );
  app.post(
    '/attendance-corrections/:id/cancel',
    { preHandler: authenticate, schema: { tags, security, params: idParams } },
    async (req, reply) => {
      await correctionsService.cancel(req.auth!, req.params.id);
      return sendSuccess(reply, null, { message: 'Correction cancelled' });
    },
  );

  /* ── Leave ── */
  leaveTypes.register(app, '/leave-types');
  leavePolicies.register(app, '/leave-policies');
  const leaveFilter = z.object({
    ...page,
    status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
    employeeId: z.uuid().optional(),
    leaveTypeId: z.uuid().optional(),
    departmentId: z.uuid().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    search: z.string().trim().min(1).max(100).optional(),
  });
  app.get(
    '/leave-requests',
    { preHandler: authenticate, schema: { tags: ltags, security, querystring: leaveFilter } },
    async (req, reply) => {
      const { items, meta } = await leaveService.list(req.auth!, req.query);
      return sendSuccess(reply, items, { meta });
    },
  );
  app.get(
    '/leave-requests/:id',
    { preHandler: authenticate, schema: { tags: ltags, security, params: idParams } },
    async (req, reply) => sendSuccess(reply, await leaveService.get(req.auth!, req.params.id)),
  );
  app.post(
    '/leave-requests',
    {
      preHandler: authenticate,
      schema: {
        tags: ltags,
        security,
        body: z.object({
          employeeId: z.uuid().optional(),
          leaveTypeId: z.uuid(),
          startDate: isoDate,
          endDate: isoDate,
          halfDay: z.enum(['am', 'pm']).nullish(),
          reason: text(1000),
        }),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await leaveService.apply(req.auth!, req.body), {
        statusCode: 201,
        message: 'Leave request submitted',
      }),
  );
  app.post(
    '/leave-requests/:id/cancel',
    {
      preHandler: authenticate,
      schema: { tags: ltags, security, params: idParams, body: z.object({ reason: text(500) }) },
    },
    async (req, reply) =>
      sendSuccess(
        reply,
        await leaveService.cancel(req.auth!, req.params.id, req.body.reason ?? null),
        { message: 'Leave cancelled' },
      ),
  );
  app.get(
    '/leave-calendar',
    {
      preHandler: authenticate,
      schema: {
        tags: ltags,
        security,
        querystring: range.and(z.object({ departmentId: z.uuid().optional() })),
      },
    },
    async (req, reply) => sendSuccess(reply, await leaveService.calendar(req.auth!, req.query)),
  );
  app.get(
    '/employees/:id/leave-balances',
    {
      preHandler: authenticate,
      schema: {
        tags: ltags,
        security,
        params: idParams,
        querystring: z.object({ year: z.coerce.number().int().min(2000).max(2100) }),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await leaveService.balances(req.auth!, req.params.id, req.query.year)),
  );
  app.post(
    '/leave-balances/adjust',
    {
      preHandler: requirePermissions(P.LEAVE_MANAGE),
      schema: {
        tags: ltags,
        security,
        body: z.object({
          employeeId: z.uuid(),
          leaveTypeId: z.uuid(),
          year: z.number().int().min(2000).max(2100),
          days: z
            .number()
            .min(-365)
            .max(365)
            .multipleOf(0.5)
            .refine((d) => d !== 0, 'Enter a non-zero adjustment'),
          reason: z.string().trim().min(3).max(300),
        }),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await leaveService.adjust(req.auth!, req.body), {
        message: 'Balance adjusted',
      }),
  );
  app.post(
    '/leave-balances/recalculate',
    {
      preHandler: requirePermissions(P.LEAVE_MANAGE),
      schema: {
        tags: ltags,
        security,
        body: z.object({ year: z.number().int().min(2000).max(2100) }),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await leaveService.recalculateEntitlements(req.auth!, req.body.year), {
        message: 'Entitlements recalculated',
      }),
  );
};
