import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { PERMISSIONS as P } from '../../shared/constants/permissions';
import { requirePermissions } from '../auth/auth.guard';
import { tenantsController as c } from './tenants.controller';
import * as s from './tenants.schema';

// Platform administration. tenants:* permissions exist only on platform roles (tenant_id IS NULL),
// so these routes are unreachable from any tenant-context session.
const tags = ['Tenants (platform)'];
const security = [{ bearerAuth: [] }];

export const tenantsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      preHandler: requirePermissions(P.TENANTS_READ),
      schema: { tags, security, summary: 'List tenants', querystring: s.listTenantsQuery },
    },
    c.list,
  );
  app.get(
    '/:id',
    {
      preHandler: requirePermissions(P.TENANTS_READ),
      schema: { tags, security, summary: 'Get tenant', params: s.tenantIdParams },
    },
    c.get,
  );
  app.post(
    '/',
    {
      preHandler: requirePermissions(P.TENANTS_MANAGE),
      schema: { tags, security, summary: 'Create tenant', body: s.createTenantBody },
    },
    c.create,
  );
  app.patch(
    '/:id',
    {
      preHandler: requirePermissions(P.TENANTS_MANAGE),
      schema: {
        tags,
        security,
        summary: 'Update tenant',
        params: s.tenantIdParams,
        body: s.updateTenantBody,
      },
    },
    c.update,
  );
  app.delete(
    '/:id',
    {
      preHandler: requirePermissions(P.TENANTS_MANAGE),
      schema: { tags, security, summary: 'Soft-delete tenant', params: s.tenantIdParams },
    },
    c.remove,
  );
};
