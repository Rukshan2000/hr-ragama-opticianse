import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { PERMISSIONS as P } from '../../shared/constants/permissions';
import { requirePermissions } from '../auth/auth.guard';
import { employeesController as c } from './employees.controller';
import * as s from './employees.schema';

const tags = ['Employees'];
const security = [{ bearerAuth: [] }];
const params = s.idParams;

export const employeesRoutes: FastifyPluginAsyncZod = async (app) => {
  const read = requirePermissions(P.EMPLOYEES_READ);
  app.get(
    '/',
    {
      preHandler: read,
      schema: { tags, security, summary: 'List employees', querystring: s.listEmployeesQuery },
    },
    c.list,
  );
  app.get(
    '/:id',
    { preHandler: read, schema: { tags, security, summary: 'Get employee', params } },
    c.get,
  );
  app.get(
    '/:id/history',
    { preHandler: read, schema: { tags, security, summary: 'Employment history', params } },
    c.history,
  );
  app.post(
    '/',
    {
      preHandler: requirePermissions(P.EMPLOYEES_CREATE),
      schema: { tags, security, summary: 'Create employee', body: s.createEmployeeBody },
    },
    c.create,
  );
  app.patch(
    '/:id',
    {
      preHandler: requirePermissions(P.EMPLOYEES_UPDATE),
      schema: { tags, security, summary: 'Update profile', params, body: s.updateEmployeeBody },
    },
    c.update,
  );
  app.post(
    '/:id/assignment',
    {
      preHandler: requirePermissions(P.EMPLOYEES_MANAGE),
      schema: {
        tags,
        security,
        summary: 'Transfer / promote / change manager',
        params,
        body: s.assignmentBody,
      },
    },
    c.assignment,
  );
  app.post(
    '/:id/status',
    {
      preHandler: requirePermissions(P.EMPLOYEES_MANAGE),
      schema: { tags, security, summary: 'Change employment status', params, body: s.statusBody },
    },
    c.status,
  );
  app.delete(
    '/:id',
    {
      preHandler: requirePermissions(P.EMPLOYEES_DELETE),
      schema: { tags, security, summary: 'Archive employee', params },
    },
    c.remove,
  );
};
