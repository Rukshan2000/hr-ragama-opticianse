import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { PERMISSIONS as P } from '../../shared/constants/permissions';
import { requirePermissions } from '../auth/auth.guard';
import { usersController as c } from './users.controller';
import * as s from './users.schema';

const tags = ['Users'];
const security = [{ bearerAuth: [] }];

export const usersRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      preHandler: requirePermissions(P.USERS_READ),
      schema: { tags, security, summary: 'List tenant users', querystring: s.listUsersQuery },
    },
    c.list,
  );
  app.get(
    '/:id',
    {
      preHandler: requirePermissions(P.USERS_READ),
      schema: { tags, security, summary: 'Get user', params: s.userIdParams },
    },
    c.get,
  );
  app.post(
    '/',
    {
      preHandler: requirePermissions(P.USERS_CREATE),
      schema: { tags, security, summary: 'Create user in tenant', body: s.createUserBody },
    },
    c.create,
  );
  app.patch(
    '/:id',
    {
      preHandler: requirePermissions(P.USERS_UPDATE),
      schema: {
        tags,
        security,
        summary: 'Update user',
        params: s.userIdParams,
        body: s.updateUserBody,
      },
    },
    c.update,
  );
  app.patch(
    '/:id/status',
    {
      preHandler: requirePermissions(P.USERS_UPDATE),
      schema: {
        tags,
        security,
        summary: 'Activate or deactivate user',
        params: s.userIdParams,
        body: s.userStatusBody,
      },
    },
    c.setStatus,
  );
  app.delete(
    '/:id',
    {
      preHandler: requirePermissions(P.USERS_DELETE),
      schema: { tags, security, summary: 'Remove user from tenant', params: s.userIdParams },
    },
    c.remove,
  );
};
