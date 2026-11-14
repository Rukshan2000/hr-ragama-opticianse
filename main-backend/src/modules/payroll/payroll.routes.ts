import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../shared/constants/permissions';
import { ConflictError } from '../../shared/errors/app-error';
import { sendSuccess } from '../../shared/utils/response';
import { tenantScope } from '../../shared/utils/tenant-scope';
import { authenticate, requirePermissions } from '../auth/auth.guard';
import {
  boolQuery,
  code,
  crudResource,
  employeeJoin,
  idParams,
  isoDate,
  money,
  name,
  patchOf,
  text,
} from '../hr-common/crud';
import { accountingService } from '../integrations/accounting.service';
import { payrollService, salaryService } from './payroll.service';
import { requireTenantId } from '../../shared/utils/tenant-scope';

const tags = ['Payroll'];
const security = [{ bearerAuth: [] }];
const rate = z.number().min(0).max(100);
const year = z.number().int().min(2000).max(2100);
const month = z.number().int().min(1).max(12);

const componentBody = z.object({
  code: code.optional(),
  name: name(100),
  kind: z.enum(['earning', 'deduction']),
  isTaxable: z.boolean().default(true),
  isEpfApplicable: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
const components = crudResource({
  table: 'salary_components',
  codePrefix: 'SC',
  label: 'Salary component',
  tag: 'Payroll',
  read: P.PAYROLL_READ,
  manage: P.PAYROLL_MANAGE,
  create: componentBody,
  patch: patchOf(componentBody),
  filters: {
    kind: { column: 'x.kind', schema: z.enum(['earning', 'deduction']) },
    isActive: { column: 'x.is_active', schema: boolQuery },
  },
  search: ['x.name', 'x.code'],
  sort: { name: 'x.name', code: 'x.code' },
  defaultSort: 'name',
  audited: true,
});

const bracket = z.object({ upTo: z.number().positive().nullable(), rate });
const policyBody = z.object({
  effectiveFrom: isoDate,
  epfEmployeeRate: rate,
  epfEmployerRate: rate,
  etfRate: rate,
  overtimeMultiplier: z.number().min(0).max(5).default(1.5),
  workingDaysPerMonth: z.number().int().min(1).max(31).default(30),
  workingHoursPerDay: z.number().min(1).max(24).default(8),
  apitBrackets: z
    .array(bracket)
    .min(1)
    .max(20)
    .refine(
      (b) =>
        b.at(-1)!.upTo === null &&
        b.slice(0, -1).every((x, i, a) => x.upTo !== null && (i === 0 || x.upTo > a[i - 1]!.upTo!)),
      {
        message: 'Brackets must ascend and end with an open (no limit) bracket',
      },
    )
    .transform((b) => JSON.stringify(b)),
  notes: text(500),
});
/** Effective-dated statutory configuration. Policies used by a finalized run are frozen. */
const policies = crudResource({
  table: 'payroll_policies',
  label: 'Payroll policy',
  tag: 'Payroll',
  read: P.PAYROLL_READ,
  manage: P.PAYROLL_MANAGE,
  create: policyBody,
  patch: patchOf(policyBody),
  sort: { effectiveFrom: 'x.effective_from' },
  defaultSort: 'effectiveFrom',
  defaultOrder: 'desc',
  audited: true,
  beforeWrite: async ({ tenantId, trx }, _data, existing) => {
    if (
      existing &&
      (await tenantScope(trx, 'payroll_runs', tenantId)
        .where({ policy_id: existing.id })
        .whereIn('status', ['approved', 'locked'])
        .first('id'))
    )
      throw new ConflictError(
        'This policy was used by a finalized payroll. Add a new effective-dated policy instead',
      );
  },
  beforeDelete: () => undefined,
});

const loanBody = z.object({
  employeeId: z.uuid(),
  type: z.enum(['loan', 'advance']),
  principal: money.positive(),
  installment: money.positive(),
  startDate: isoDate,
  notes: text(300),
});
const loans = crudResource({
  table: 'employee_loans',
  label: 'Loan',
  tag: 'Payroll',
  read: P.PAYROLL_READ,
  manage: P.PAYROLL_MANAGE,
  create: loanBody,
  patch: patchOf(
    z.object({
      installment: money.positive(),
      status: z.enum(['active', 'settled', 'cancelled']),
      notes: text(300),
    }),
  ),
  filters: {
    employeeId: { column: 'x.employee_id', schema: z.uuid() },
    status: { column: 'x.status', schema: z.enum(['active', 'settled', 'cancelled']) },
  },
  search: ['employee.first_name', 'employee.last_name', 'employee.employee_number'],
  sort: { startDate: 'x.start_date', employee: 'employee.first_name' },
  defaultSort: 'startDate',
  defaultOrder: 'desc',
  select: employeeJoin(),
  audited: true,
  beforeWrite: async (_c, data, existing) => {
    if (!existing) data.balance = data.principal;
  },
});

const adjustmentBody = z.object({
  employeeId: z.uuid(),
  year,
  month,
  kind: z.enum(['earning', 'deduction']),
  label: name(100),
  amount: money.positive(),
  isTaxable: z.boolean().default(true),
  isEpfApplicable: z.boolean().default(false),
  reason: text(300),
});
/** Bonuses, commissions and corrections. Periods with a finalized run are closed. */
async function assertOpenPeriod(
  trx: Parameters<NonNullable<Parameters<typeof crudResource>[0]['beforeWrite']>>[0]['trx'],
  tenantId: string,
  y: unknown,
  m: unknown,
) {
  const run = await tenantScope(trx, 'payroll_runs', tenantId)
    .where({ year: y, month: m })
    .whereIn('status', ['approved', 'locked'])
    .first('id');
  if (run)
    throw new ConflictError(
      'Payroll for this period is finalized. Record the adjustment in the next open period',
    );
}
const adjustments = crudResource({
  table: 'payroll_adjustments',
  label: 'Payroll adjustment',
  tag: 'Payroll',
  read: P.PAYROLL_READ,
  manage: P.PAYROLL_MANAGE,
  create: adjustmentBody,
  patch: patchOf(adjustmentBody.omit({ employeeId: true })),
  filters: {
    employeeId: { column: 'x.employee_id', schema: z.uuid() },
    year: { column: 'x.year', schema: z.coerce.number().int() },
    month: { column: 'x.month', schema: z.coerce.number().int() },
  },
  search: ['x.label', 'employee.first_name', 'employee.last_name'],
  sort: { period: 'x.year', createdAt: 'x.created_at' },
  defaultSort: 'createdAt',
  defaultOrder: 'desc',
  select: employeeJoin(),
  audited: true,
  beforeWrite: async ({ auth, tenantId, trx }, data, existing) => {
    if (existing) await assertOpenPeriod(trx, tenantId, existing.year, existing.month);
    await assertOpenPeriod(
      trx,
      tenantId,
      data.year ?? existing?.year,
      data.month ?? existing?.month,
    );
    if (!existing) data.created_by = auth.userId;
  },
  beforeDelete: () => undefined,
});

export const payrollRoutes: FastifyPluginAsyncZod = async (app) => {
  components.register(app, '/salary-components');
  policies.register(app, '/payroll-policies');
  loans.register(app, '/loans');
  adjustments.register(app, '/payroll-adjustments');

  const read = requirePermissions(P.PAYROLL_READ);
  const manage = requirePermissions(P.PAYROLL_MANAGE);
  const approve = requirePermissions(P.PAYROLL_APPROVE);

  app.get(
    '/salaries',
    {
      preHandler: read,
      schema: {
        tags,
        security,
        querystring: z.object({
          search: z.string().trim().min(1).max(100).optional(),
          departmentId: z.uuid().optional(),
        }),
      },
    },
    async (req, reply) => sendSuccess(reply, await salaryService.current(req.auth!, req.query)),
  );
  app.get(
    '/employees/:id/salaries',
    { preHandler: read, schema: { tags, security, params: idParams } },
    async (req, reply) => sendSuccess(reply, await salaryService.history(req.auth!, req.params.id)),
  );
  app.post(
    '/salaries',
    {
      preHandler: manage,
      schema: {
        tags,
        security,
        summary: 'Salary revision (effective-dated)',
        body: z.object({
          employeeId: z.uuid(),
          effectiveFrom: isoDate,
          basicSalary: money,
          reason: text(300),
          items: z
            .array(z.object({ componentId: z.uuid(), amount: money }))
            .max(30)
            .default([]),
        }),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await salaryService.revise(req.auth!, req.body), {
        statusCode: 201,
        message: 'Salary revised',
      }),
  );
  app.delete(
    '/salaries/:id',
    { preHandler: manage, schema: { tags, security, params: idParams } },
    async (req, reply) => {
      await salaryService.removeRevision(req.auth!, req.params.id);
      return sendSuccess(reply, null, { message: 'Revision deleted' });
    },
  );

  app.get(
    '/payroll-runs',
    {
      preHandler: read,
      schema: {
        tags,
        security,
        querystring: z.object({ year: z.coerce.number().int().optional() }),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await payrollService.listRuns(req.auth!, req.query.year)),
  );
  app.get(
    '/payroll-runs/:id',
    { preHandler: read, schema: { tags, security, params: idParams } },
    async (req, reply) => sendSuccess(reply, await payrollService.getRun(req.auth!, req.params.id)),
  );
  app.post(
    '/payroll-runs',
    { preHandler: manage, schema: { tags, security, body: z.object({ year, month }) } },
    async (req, reply) =>
      sendSuccess(reply, await payrollService.createRun(req.auth!, req.body.year, req.body.month), {
        statusCode: 201,
        message: 'Payroll period created',
      }),
  );
  app.post(
    '/payroll-runs/:id/calculate',
    { preHandler: manage, schema: { tags, security, params: idParams } },
    async (req, reply) =>
      sendSuccess(reply, await payrollService.calculate(req.auth!, req.params.id), {
        message: 'Payroll calculated',
      }),
  );
  app.post(
    '/payroll-runs/:id/approve',
    { preHandler: approve, schema: { tags, security, params: idParams } },
    async (req, reply) =>
      sendSuccess(reply, await payrollService.approve(req.auth!, req.params.id), {
        message: 'Payroll approved',
      }),
  );
  app.post(
    '/payroll-runs/:id/send-to-accounting',
    { preHandler: approve, schema: { tags, security, params: idParams } },
    async (req, reply) =>
      sendSuccess(
        reply,
        await accountingService.sendRun(requireTenantId(req.auth!), req.params.id),
        { message: 'Sent to accounting' },
      ),
  );
  app.get(
    '/payroll-runs/:id/accounting-status',
    { preHandler: read, schema: { tags, security, params: idParams } },
    async (req, reply) =>
      sendSuccess(reply, await accountingService.status(requireTenantId(req.auth!), req.params.id)),
  );
  app.post(
    '/payroll-runs/:id/lock',
    { preHandler: approve, schema: { tags, security, params: idParams } },
    async (req, reply) =>
      sendSuccess(reply, await payrollService.lock(req.auth!, req.params.id), {
        message: 'Payroll locked',
      }),
  );
  app.delete(
    '/payroll-runs/:id',
    { preHandler: manage, schema: { tags, security, params: idParams } },
    async (req, reply) => {
      await payrollService.removeRun(req.auth!, req.params.id);
      return sendSuccess(reply, null, { message: 'Payroll deleted' });
    },
  );

  app.get(
    '/payslips/mine',
    { preHandler: requirePermissions(P.SELF_SERVICE), schema: { tags, security } },
    async (req, reply) => sendSuccess(reply, await payrollService.myPayslips(req.auth!)),
  );
  app.get(
    '/payslips/:id',
    { preHandler: authenticate, schema: { tags, security, params: idParams } },
    async (req, reply) =>
      sendSuccess(reply, await payrollService.payslip(req.auth!, req.params.id)),
  );
  app.get(
    '/payslips/:id/pdf',
    { preHandler: authenticate, schema: { tags, security, params: idParams } },
    async (req, reply) => {
      const { pdf, filename } = await payrollService.payslipPdf(req.auth!, req.params.id);
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .header('cache-control', 'private, no-store')
        .send(pdf);
    },
  );
};
