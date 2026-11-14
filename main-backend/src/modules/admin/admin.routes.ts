import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../../database/knex';
import { PERMISSIONS as P } from '../../shared/constants/permissions';
import { ConflictError } from '../../shared/errors/app-error';
import { sendSuccess } from '../../shared/utils/response';
import { authenticate, requirePermissions } from '../auth/auth.guard';
import {
  boolQuery,
  code,
  crudResource,
  idParams,
  isoDate,
  money,
  name,
  patchOf,
  text,
} from '../hr-common/crud';
import { findMyEmployee } from '../hr-common/me';
import { assetsService, expensesService, exitService } from './admin.service';

const tags = ['Administration'];
const security = [{ bearerAuth: [] }];
const CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged'] as const;

const categoryBody = z.object({
  code: code.optional(),
  name: name(100),
  isActive: z.boolean().default(true),
});
const assetCategories = crudResource({
  table: 'asset_categories',
  codePrefix: 'AC',
  label: 'Asset category',
  tag: 'Administration',
  read: P.ASSETS_READ,
  manage: P.ASSETS_MANAGE,
  create: categoryBody,
  patch: patchOf(categoryBody),
  filters: { isActive: { column: 'x.is_active', schema: boolQuery } },
  search: ['x.name', 'x.code'],
  sort: { name: 'x.name', code: 'x.code' },
  defaultSort: 'name',
});

const assetBody = z.object({
  categoryId: z.uuid(),
  assetTag: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9._/-]+$/, 'Use letters, numbers, dot, dash, slash or underscore'),
  name: name(150),
  serialNumber: text(100),
  purchaseDate: isoDate.nullish(),
  purchaseCost: money.nullish(),
  condition: z.enum(CONDITIONS).default('good'),
  notes: text(1000),
});
const STATUSES = ['available', 'assigned', 'maintenance', 'retired'] as const;
const assets = crudResource({
  table: 'assets',
  label: 'Asset',
  tag: 'Administration',
  read: P.ASSETS_READ,
  manage: P.ASSETS_MANAGE,
  create: assetBody,
  patch: patchOf(assetBody.extend({ status: z.enum(['available', 'maintenance', 'retired']) })),
  filters: {
    status: { column: 'x.status', schema: z.enum(STATUSES) },
    categoryId: { column: 'x.category_id', schema: z.uuid() },
    condition: { column: 'x.condition', schema: z.enum(CONDITIONS) },
  },
  search: ['x.name', 'x.asset_tag', 'x.serial_number'],
  sort: { name: 'x.name', assetTag: 'x.asset_tag', purchaseDate: 'x.purchase_date' },
  defaultSort: 'assetTag',
  select: (q) =>
    q
      .join('asset_categories as c', 'c.id', 'x.category_id')
      .leftJoin('asset_assignments as h', function () {
        this.on('h.asset_id', 'x.id').andOnNull('h.returned_on');
      })
      .leftJoin('employees as e', 'e.id', 'h.employee_id')
      .select(
        'c.name as category_name',
        'h.employee_id as holder_id',
        db.raw(`e.first_name || ' ' || e.last_name as holder_name`),
        'h.assigned_on',
      ),
  beforeWrite: async (_c, data, existing) => {
    if (existing?.status === 'assigned' && data.status)
      throw new ConflictError('Record the return before changing the status of an assigned asset');
  },
  audited: true,
});

const expenseCategoryBody = z.object({
  code: code.optional(),
  name: name(100),
  maxAmount: money.positive().nullish(),
  requiresReceipt: z.boolean().default(true),
  isActive: z.boolean().default(true),
});
const expenseCategories = crudResource({
  table: 'expense_categories',
  codePrefix: 'EC',
  label: 'Expense category',
  tag: 'Administration',
  read: P.SELF_SERVICE,
  manage: P.EXPENSES_MANAGE,
  create: expenseCategoryBody,
  patch: patchOf(expenseCategoryBody),
  filters: { isActive: { column: 'x.is_active', schema: boolQuery } },
  search: ['x.name', 'x.code'],
  sort: { name: 'x.name', code: 'x.code' },
  defaultSort: 'name',
});

export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  assetCategories.register(app, '/asset-categories');
  assets.register(app, '/assets');
  const manageA = requirePermissions(P.ASSETS_MANAGE);
  app.post(
    '/assets/:id/assign',
    {
      preHandler: manageA,
      schema: {
        tags,
        security,
        params: idParams,
        body: z.object({
          employeeId: z.uuid(),
          assignedOn: isoDate,
          expectedReturnOn: isoDate.nullish(),
          notes: text(500),
        }),
      },
    },
    async (req, reply) => {
      await assetsService.assign(req.auth!, req.params.id, req.body);
      return sendSuccess(reply, await assets.service.get(req.auth!, req.params.id), {
        message: 'Asset assigned',
      });
    },
  );
  app.post(
    '/assets/:id/return',
    {
      preHandler: manageA,
      schema: {
        tags,
        security,
        params: idParams,
        body: z.object({ returnedOn: isoDate, conditionIn: z.enum(CONDITIONS), notes: text(500) }),
      },
    },
    async (req, reply) => {
      await assetsService.return(req.auth!, req.params.id, req.body);
      return sendSuccess(reply, await assets.service.get(req.auth!, req.params.id), {
        message: 'Return recorded',
      });
    },
  );
  app.get(
    '/asset-assignments',
    {
      preHandler: authenticate,
      schema: {
        tags,
        security,
        querystring: z.object({
          assetId: z.uuid().optional(),
          employeeId: z.uuid().optional(),
          open: z
            .enum(['true', 'false'])
            .transform((v) => v === 'true')
            .optional(),
          mine: z.enum(['true']).optional(),
        }),
      },
    },
    async (req, reply) => {
      const q = { ...req.query };
      if (q.mine || !req.auth!.permissions.has(P.ASSETS_READ))
        q.employeeId =
          (await findMyEmployee(req.auth!))?.id ?? '00000000-0000-0000-0000-000000000000';
      return sendSuccess(reply, await assetsService.history(req.auth!, q));
    },
  );

  expenseCategories.register(app, '/expense-categories');
  app.get(
    '/expense-claims',
    {
      preHandler: authenticate,
      schema: {
        tags,
        security,
        querystring: z.object({
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(20),
          status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'reimbursed']).optional(),
          employeeId: z.uuid().optional(),
          categoryId: z.uuid().optional(),
          from: isoDate.optional(),
          to: isoDate.optional(),
          search: z.string().trim().min(1).max(100).optional(),
          mine: z
            .enum(['true', 'false'])
            .transform((v) => v === 'true')
            .optional(),
        }),
      },
    },
    async (req, reply) => {
      const { items, meta } = await expensesService.list(req.auth!, req.query);
      return sendSuccess(reply, items, { meta });
    },
  );
  app.get(
    '/expense-claims/:id',
    { preHandler: authenticate, schema: { tags, security, params: idParams } },
    async (req, reply) => sendSuccess(reply, await expensesService.get(req.auth!, req.params.id)),
  );
  app.post(
    '/expense-claims',
    {
      preHandler: authenticate,
      schema: {
        tags,
        security,
        body: z.object({
          employeeId: z.uuid().optional(),
          categoryId: z.uuid(),
          expenseDate: isoDate,
          amount: money.positive(),
          description: z.string().trim().min(3).max(1000),
          receiptFileId: z.uuid().nullish(),
        }),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await expensesService.create(req.auth!, req.body), {
        statusCode: 201,
        message: 'Claim submitted',
      }),
  );
  app.post(
    '/expense-claims/:id/cancel',
    { preHandler: authenticate, schema: { tags, security, params: idParams } },
    async (req, reply) =>
      sendSuccess(reply, await expensesService.cancel(req.auth!, req.params.id), {
        message: 'Claim cancelled',
      }),
  );
  app.post(
    '/expense-claims/:id/reimburse',
    {
      preHandler: requirePermissions(P.EXPENSES_MANAGE),
      schema: {
        tags,
        security,
        params: idParams,
        body: z.object({ reimbursedOn: isoDate, paymentReference: text(100) }),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await expensesService.reimburse(req.auth!, req.params.id, req.body), {
        message: 'Reimbursement recorded',
      }),
  );

  const manageX = requirePermissions(P.EXIT_MANAGE);
  app.get(
    '/exit-cases',
    {
      preHandler: requirePermissions(P.EXIT_READ),
      schema: {
        tags,
        security,
        querystring: z.object({
          status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'completed']).optional(),
          exitType: z.enum(['resignation', 'termination']).optional(),
          search: z.string().trim().min(1).max(100).optional(),
        }),
      },
    },
    async (req, reply) => sendSuccess(reply, await exitService.list(req.auth!, req.query)),
  );
  app.get(
    '/exit-cases/mine',
    { preHandler: authenticate, schema: { tags, security } },
    async (req, reply) => sendSuccess(reply, await exitService.mine(req.auth!)),
  );
  app.get(
    '/exit-cases/:id',
    { preHandler: authenticate, schema: { tags, security, params: idParams } },
    async (req, reply) => sendSuccess(reply, await exitService.get(req.auth!, req.params.id)),
  );
  app.post(
    '/exit-cases',
    {
      preHandler: authenticate,
      schema: {
        tags,
        security,
        body: z.object({
          employeeId: z.uuid().optional(),
          exitType: z.enum(['resignation', 'termination']).default('resignation'),
          noticeDate: isoDate,
          noticeDays: z.number().int().min(0).max(365).default(30),
          lastWorkingDay: isoDate.nullish(),
          reason: text(2000),
        }),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await exitService.create(req.auth!, req.body), {
        statusCode: 201,
        message: 'Exit request submitted',
      }),
  );
  app.post(
    '/exit-cases/:id/withdraw',
    { preHandler: authenticate, schema: { tags, security, params: idParams } },
    async (req, reply) =>
      sendSuccess(reply, await exitService.withdraw(req.auth!, req.params.id), {
        message: 'Exit request withdrawn',
      }),
  );
  app.patch(
    '/exit-cases/:id',
    {
      preHandler: manageX,
      schema: {
        tags,
        security,
        params: idParams,
        body: z
          .object({
            lastWorkingDay: isoDate,
            interviewDate: isoDate.nullable(),
            interviewNotes: text(10000),
            settlementEarnings: money.nullable(),
            settlementDeductions: money.nullable(),
            settlementPaidOn: isoDate.nullable(),
            settlementNotes: text(1000),
          })
          .partial(),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await exitService.update(req.auth!, req.params.id, req.body), {
        message: 'Exit case updated',
      }),
  );
  app.patch(
    '/exit-cases/:id/clearances/:clearanceId',
    {
      preHandler: manageX,
      schema: {
        tags,
        security,
        params: z.object({ id: z.uuid(), clearanceId: z.uuid() }),
        body: z.object({ isCleared: z.boolean(), notes: text(500) }),
      },
    },
    async (req, reply) =>
      sendSuccess(
        reply,
        await exitService.clear(req.auth!, req.params.id, req.params.clearanceId, req.body),
        { message: 'Clearance updated' },
      ),
  );
  app.post(
    '/exit-cases/:id/complete',
    {
      preHandler: [...manageX, ...requirePermissions(P.EMPLOYEES_MANAGE).slice(1)],
      schema: { tags, security, params: idParams },
    },
    async (req, reply) =>
      sendSuccess(reply, await exitService.complete(req.auth!, req.params.id), {
        message: 'Exit completed',
      }),
  );
};
