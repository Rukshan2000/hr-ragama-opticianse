import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PERMISSIONS as P } from '../../shared/constants/permissions';
import { NotFoundError } from '../../shared/errors/app-error';
import { sendSuccess } from '../../shared/utils/response';
import { authenticate, requirePermissions } from '../auth/auth.guard';
import { idParams, isoDate, text } from '../hr-common/crud';
import { portalService } from './portal.service';
import {
  availableReports,
  dashboardService,
  REPORTS,
  runReport,
  toCsv,
  toSpreadsheetXml,
} from './reports.service';

const tags = ['Self-service & reports'];
const security = [{ bearerAuth: [] }];
const self = requirePermissions(P.SELF_SERVICE);

export const portalRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/me/profile', { preHandler: self, schema: { tags, security } }, async (req, reply) =>
    sendSuccess(reply, await portalService.profile(req.auth!)),
  );
  app.get('/me/overview', { preHandler: self, schema: { tags, security } }, async (req, reply) =>
    sendSuccess(reply, await portalService.overview(req.auth!)),
  );
  app.patch(
    '/me/profile',
    {
      preHandler: self,
      schema: {
        tags,
        security,
        summary:
          'Contact details save directly; name, email, birth date and gender need HR approval',
        body: z
          .object({
            phone: text(30),
            address: text(500),
            emergencyContactName: text(150),
            emergencyContactPhone: text(30),
            emergencyContactRelationship: text(50),
            firstName: z.string().trim().min(1).max(100),
            lastName: z.string().trim().min(1).max(100),
            displayName: text(150),
            email: z
              .email()
              .max(255)
              .transform((e) => e.toLowerCase()),
            dateOfBirth: isoDate,
            gender: z.enum(['male', 'female', 'other', 'undisclosed']),
            reason: text(500),
          })
          .partial()
          .refine((b) => Object.keys(b).some((k) => k !== 'reason'), 'Change at least one field'),
      },
    },
    async (req, reply) => {
      const { reason, ...fields } = req.body;
      const res = await portalService.updateProfile(
        req.auth!,
        fields as Record<string, string | null>,
        reason ?? null,
      );
      return sendSuccess(reply, res, {
        message: res.approvalRequested
          ? 'Saved. Sensitive changes were sent to HR for approval'
          : 'Profile updated',
      });
    },
  );

  app.get(
    '/employees/:id/account',
    {
      preHandler: requirePermissions(P.EMPLOYEES_READ),
      schema: { tags, security, params: idParams },
    },
    async (req, reply) =>
      sendSuccess(reply, await portalService.linkedUser(req.auth!, req.params.id)),
  );
  app.put(
    '/employees/:id/account',
    {
      preHandler: [
        ...requirePermissions(P.EMPLOYEES_MANAGE),
        ...requirePermissions(P.USERS_READ).slice(1),
      ],
      schema: { tags, security, params: idParams, body: z.object({ userId: z.uuid().nullable() }) },
    },
    async (req, reply) =>
      sendSuccess(
        reply,
        await portalService.linkAccount(req.auth!, req.params.id, req.body.userId),
        { message: req.body.userId ? 'Account linked' : 'Account unlinked' },
      ),
  );

  app.get(
    '/dashboard',
    { preHandler: authenticate, schema: { tags, security } },
    async (req, reply) => sendSuccess(reply, await dashboardService.get(req.auth!)),
  );

  app.get(
    '/reports',
    { preHandler: authenticate, schema: { tags, security } },
    async (req, reply) => sendSuccess(reply, availableReports(req.auth!)),
  );
  app.get(
    '/reports/:type',
    {
      preHandler: requirePermissions(P.REPORTS_READ),
      schema: {
        tags,
        security,
        params: z.object({ type: z.string().max(30) }),
        querystring: z.object({
          format: z.enum(['json', 'csv', 'xls']).default('json'),
          from: isoDate.optional(),
          to: isoDate.optional(),
          branchId: z.uuid().optional(),
          departmentId: z.uuid().optional(),
          employeeId: z.uuid().optional(),
          year: z.coerce.number().int().min(2000).max(2100).optional(),
          month: z.coerce.number().int().min(1).max(12).optional(),
        }),
      },
    },
    async (req, reply) => {
      if (!(req.params.type in REPORTS)) throw new NotFoundError('Report');
      const { format, ...q } = req.query;
      const r = await runReport(req.auth!, req.params.type, q);
      if (format === 'json') return sendSuccess(reply, r);
      const name = `${req.params.type}-${new Date().toISOString().slice(0, 10)}`;
      reply.header('cache-control', 'private, no-store');
      if (format === 'csv')
        return reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${name}.csv"`)
          .send(toCsv(r.columns, r.rows));
      return reply
        .header('content-type', 'application/vnd.ms-excel; charset=utf-8')
        .header('content-disposition', `attachment; filename="${name}.xls"`)
        .send(toSpreadsheetXml(r.title, r.columns, r.rows));
    },
  );
};
