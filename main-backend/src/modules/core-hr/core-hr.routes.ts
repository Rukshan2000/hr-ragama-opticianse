import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db } from '../../database/knex';
import { PERMISSIONS as P } from '../../shared/constants/permissions';
import { sendSuccess } from '../../shared/utils/response';
import { requireTenantId, tenantScope } from '../../shared/utils/tenant-scope';
import { authenticate, requirePermissions } from '../auth/auth.guard';
import { crudResource, idParams, isoDate, name, patchOf, text } from '../hr-common/crud';
import {
  auditService,
  contractsService,
  runHrReminders,
  settingsService,
  tasksService,
} from './core-hr.service';

const tags = ['Core HR'];
const security = [{ bearerAuth: [] }];
const timezones = new Set(Intl.supportedValuesOf('timeZone'));
const kind = z.enum(['onboarding', 'exit']);
const CONTRACT_TYPES = ['permanent', 'temporary', 'contract', 'internship'] as const;
const contractNumber = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9._/-]+$/, 'Use letters, numbers, dot, dash, slash or underscore');

const templateBody = z.object({
  kind,
  title: name(200),
  description: text(500),
  dueDays: z.number().int().min(-90).max(365).default(0),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});
export const checklistTemplates = crudResource({
  table: 'checklist_templates',
  label: 'Checklist item',
  tag: 'Core HR',
  read: P.EMPLOYEES_READ,
  manage: P.EMPLOYEES_MANAGE,
  create: templateBody,
  patch: patchOf(templateBody),
  filters: { kind: { column: 'x.kind', schema: kind } },
  search: ['x.title'],
  sort: { sortOrder: 'x.sort_order', title: 'x.title' },
  defaultSort: 'sortOrder',
});

const announcementBody = z
  .object({
    title: name(200),
    body: z.string().trim().min(1).max(20000),
    publishOn: isoDate,
    expiresOn: isoDate.nullish(),
    isPinned: z.boolean().default(false),
  })
  .refine((b) => !b.expiresOn || b.expiresOn >= b.publishOn, {
    message: 'Expiry must be after publishing',
    path: ['expiresOn'],
  });
export const announcements = crudResource({
  table: 'announcements',
  label: 'Announcement',
  tag: 'Core HR',
  read: P.ANNOUNCEMENTS_MANAGE,
  manage: P.ANNOUNCEMENTS_MANAGE,
  create: announcementBody,
  patch: patchOf(
    z.object({
      title: name(200),
      body: z.string().trim().min(1).max(20000),
      publishOn: isoDate,
      expiresOn: isoDate.nullish(),
      isPinned: z.boolean(),
    }),
  ),
  search: ['x.title'],
  sort: { publishOn: 'x.publish_on', title: 'x.title' },
  defaultSort: 'publishOn',
  defaultOrder: 'desc',
  beforeWrite: async ({ auth }, data, existing) => {
    if (!existing) data.created_by = auth.userId;
  },
});

const contractBody = z
  .object({
    employeeId: z.uuid(),
    contractNumber,
    contractType: z.enum(CONTRACT_TYPES),
    startDate: isoDate,
    endDate: isoDate.nullish(),
    probationEndDate: isoDate.nullish(),
    fileId: z.uuid().nullish(),
    notes: text(1000),
  })
  .refine((b) => !b.endDate || b.endDate >= b.startDate, {
    message: 'End must be on or after start',
    path: ['endDate'],
  })
  .refine((b) => b.contractType === 'permanent' || b.endDate, {
    message: 'Fixed-term contracts need an end date',
    path: ['endDate'],
  });

export const coreHrRoutes: FastifyPluginAsyncZod = async (app) => {
  // Settings
  app.get(
    '/settings',
    { preHandler: authenticate, schema: { tags, security } },
    async (req, reply) => sendSuccess(reply, await settingsService.get(req.auth!)),
  );
  app.patch(
    '/settings',
    {
      preHandler: requirePermissions(P.SETTINGS_MANAGE),
      schema: {
        tags,
        security,
        body: z
          .object({
            timezone: z.string().refine((t) => timezones.has(t), 'Unknown IANA time zone'),
            currency: z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code'),
            contractReminderDays: z.number().int().min(1).max(365),
            probationReminderDays: z.number().int().min(1).max(365),
          })
          .partial(),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await settingsService.update(req.auth!, req.body), {
        message: 'Settings saved',
      }),
  );

  // Audit log
  app.get(
    '/audit',
    {
      preHandler: requirePermissions(P.AUDIT_READ),
      schema: {
        tags,
        security,
        querystring: z.object({
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(25),
          entityType: z.string().max(40).optional(),
          entityId: z.uuid().optional(),
          search: z.string().trim().min(1).max(100).optional(),
          from: isoDate.optional(),
          to: isoDate.optional(),
        }),
      },
    },
    async (req, reply) => {
      const { items, meta } = await auditService.list(req.auth!, req.query);
      return sendSuccess(reply, items, { meta });
    },
  );

  // Checklists
  checklistTemplates.register(app, '/checklist-templates');
  const manageEmp = requirePermissions(P.EMPLOYEES_MANAGE);
  app.get(
    '/tasks/board',
    {
      preHandler: requirePermissions(P.EMPLOYEES_READ),
      schema: { tags, security, querystring: z.object({ kind }) },
    },
    async (req, reply) => sendSuccess(reply, await tasksService.board(req.auth!, req.query.kind)),
  );
  app.get(
    '/employees/:id/tasks',
    {
      preHandler: authenticate,
      schema: {
        tags,
        security,
        params: idParams,
        querystring: z.object({ kind: kind.optional() }),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await tasksService.list(req.auth!, req.params.id, req.query.kind)),
  );
  app.post(
    '/employees/:id/tasks/generate',
    {
      preHandler: manageEmp,
      schema: { tags, security, params: idParams, body: z.object({ kind }) },
    },
    async (req, reply) =>
      sendSuccess(reply, await tasksService.generate(req.auth!, req.params.id, req.body.kind), {
        message: 'Checklist created',
      }),
  );
  app.post(
    '/employees/:id/tasks',
    {
      preHandler: manageEmp,
      schema: {
        tags,
        security,
        params: idParams,
        body: z.object({
          kind,
          title: name(200),
          description: text(500),
          dueDate: isoDate.nullish(),
        }),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await tasksService.add(req.auth!, req.params.id, req.body), {
        statusCode: 201,
        message: 'Task added',
      }),
  );
  app.patch(
    '/tasks/:id',
    {
      preHandler: manageEmp,
      schema: { tags, security, params: idParams, body: z.object({ done: z.boolean() }) },
    },
    async (req, reply) => {
      await tasksService.setDone(req.auth!, req.params.id, req.body.done);
      return sendSuccess(reply, null, {
        message: req.body.done ? 'Task completed' : 'Task reopened',
      });
    },
  );
  app.delete(
    '/tasks/:id',
    { preHandler: manageEmp, schema: { tags, security, params: idParams } },
    async (req, reply) => {
      await tasksService.remove(req.auth!, req.params.id);
      return sendSuccess(reply, null, { message: 'Task deleted' });
    },
  );

  // Contracts
  const readC = requirePermissions(P.CONTRACTS_READ);
  const manageC = requirePermissions(P.CONTRACTS_MANAGE);
  app.get(
    '/contracts',
    {
      preHandler: readC,
      schema: {
        tags,
        security,
        querystring: z.object({
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(20),
          search: z.string().trim().min(1).max(100).optional(),
          status: z.enum(['draft', 'active', 'expired', 'terminated', 'renewed']).optional(),
          contractType: z.enum(CONTRACT_TYPES).optional(),
          employeeId: z.uuid().optional(),
          expiringWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { items, meta } = await contractsService.list(req.auth!, req.query);
      return sendSuccess(reply, items, { meta });
    },
  );
  app.get(
    '/contracts/:id',
    { preHandler: readC, schema: { tags, security, params: idParams } },
    async (req, reply) => sendSuccess(reply, await contractsService.get(req.auth!, req.params.id)),
  );
  app.post(
    '/contracts',
    { preHandler: manageC, schema: { tags, security, body: contractBody } },
    async (req, reply) =>
      sendSuccess(reply, await contractsService.create(req.auth!, req.body), {
        statusCode: 201,
        message: 'Contract created',
      }),
  );
  app.patch(
    '/contracts/:id',
    {
      preHandler: manageC,
      schema: {
        tags,
        security,
        params: idParams,
        body: z
          .object({
            contractNumber,
            contractType: z.enum(CONTRACT_TYPES),
            startDate: isoDate,
            endDate: isoDate.nullable(),
            probationEndDate: isoDate.nullable(),
            fileId: z.uuid().nullable(),
            notes: text(1000),
          })
          .partial(),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await contractsService.update(req.auth!, req.params.id, req.body), {
        message: 'Contract updated',
      }),
  );
  app.delete(
    '/contracts/:id',
    { preHandler: manageC, schema: { tags, security, params: idParams } },
    async (req, reply) => {
      await contractsService.remove(req.auth!, req.params.id);
      return sendSuccess(reply, null, { message: 'Contract deleted' });
    },
  );
  app.post(
    '/contracts/:id/activate',
    { preHandler: manageC, schema: { tags, security, params: idParams } },
    async (req, reply) =>
      sendSuccess(reply, await contractsService.activate(req.auth!, req.params.id), {
        message: 'Contract activated',
      }),
  );
  app.post(
    '/contracts/:id/renew',
    {
      preHandler: manageC,
      schema: {
        tags,
        security,
        params: idParams,
        body: z
          .object({
            contractNumber,
            startDate: isoDate,
            endDate: isoDate.nullish(),
            fileId: z.uuid().nullish(),
            notes: text(1000),
          })
          .refine((b) => !b.endDate || b.endDate >= b.startDate, {
            message: 'End must be on or after start',
            path: ['endDate'],
          }),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await contractsService.renew(req.auth!, req.params.id, req.body), {
        statusCode: 201,
        message: 'Contract renewed',
      }),
  );
  app.post(
    '/contracts/:id/terminate',
    {
      preHandler: manageC,
      schema: {
        tags,
        security,
        params: idParams,
        body: z.object({ endDate: isoDate, reason: text(500) }),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await contractsService.terminate(req.auth!, req.params.id, req.body), {
        message: 'Contract terminated',
      }),
  );
  app.post(
    '/contracts/:id/confirm',
    {
      preHandler: [...manageC, ...requirePermissions(P.EMPLOYEES_MANAGE).slice(1)],
      schema: {
        tags,
        security,
        params: idParams,
        body: z.object({ confirmedOn: isoDate, reason: text(500) }),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await contractsService.confirm(req.auth!, req.params.id, req.body), {
        message: 'Employment confirmed',
      }),
  );
  app.post(
    '/contracts/reminders/run',
    { preHandler: manageC, schema: { tags, security } },
    async (_req, reply) => {
      await runHrReminders();
      return sendSuccess(reply, null, { message: 'Reminders processed' });
    },
  );

  // Announcements: managed by HR; every member reads the active ones.
  announcements.register(app, '/announcements');
  app.get(
    '/announcements-feed',
    { preHandler: authenticate, schema: { tags, security } },
    async (req, reply) =>
      sendSuccess(
        reply,
        await tenantScope(db, 'announcements as a', requireTenantId(req.auth))
          .leftJoin('users as u', 'u.id', 'a.created_by')
          .where('a.publish_on', '<=', db.raw('CURRENT_DATE'))
          .where((w) =>
            w.whereNull('a.expires_on').orWhere('a.expires_on', '>=', db.raw('CURRENT_DATE')),
          )
          .orderBy([
            { column: 'a.is_pinned', order: 'desc' },
            { column: 'a.publish_on', order: 'desc' },
          ])
          .limit(20)
          .select(
            'a.id',
            'a.title',
            'a.body',
            'a.publish_on as publishOn',
            'a.is_pinned as isPinned',
            'u.name as authorName',
          ),
      ),
  );
};
