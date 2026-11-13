import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { PERMISSIONS as P } from '../../shared/constants/permissions';
import { requirePermissions } from '../auth/auth.guard';
import { rolesController as c } from './roles.controller';
import * as s from './roles.schema';

const tags = ['Roles'];
const security = [{ bearerAuth: [] }];

export const rolesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      preHandler: requirePermissions(P.ROLES_READ),
      schema: { tags, security, summary: 'List tenant roles', querystring: s.listRolesQuery },
    },
    c.list,
  );
  app.get(
    '/:id',
    {
      preHandler: requirePermissions(P.ROLES_READ),
      schema: { tags, security, summary: 'Get role', params: s.roleIdParams },
    },
    c.get,
  );
  app.post(
    '/',
    {
      preHandler: requirePermissions(P.ROLES_MANAGE),
      schema: { tags, security, summary: 'Create role', body: s.createRoleBody },
    },
    c.create,
  );
  app.patch(
    '/:id',
    {
      preHandler: requirePermissions(P.ROLES_MANAGE),
      schema: {
        tags,
        security,
        summary: 'Update role',
        params: s.roleIdParams,
        body: s.updateRoleBody,
      },
    },
    c.update,
  );
  app.delete(
    '/:id',
    {
      preHandler: requirePermissions(P.ROLES_MANAGE),
      schema: { tags, security, summary: 'Delete role', params: s.roleIdParams },
    },
    c.remove,
  );
};
