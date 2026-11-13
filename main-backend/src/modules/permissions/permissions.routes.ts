import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { db } from '../../database/knex';
import { PERMISSIONS as P } from '../../shared/constants/permissions';
import { sendSuccess } from '../../shared/utils/response';
import { requirePermissions } from '../auth/auth.guard';

// Read-only catalog: too small to warrant separate controller/service/repository layers.
export const permissionsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      preHandler: requirePermissions(P.PERMISSIONS_READ),
      schema: {
        tags: ['Permissions'],
        security: [{ bearerAuth: [] }],
        summary: 'List permissions',
      },
    },
    async (_req, reply) =>
      sendSuccess(reply, await db('permissions').select('id', 'key', 'description').orderBy('key')),
  );
};
