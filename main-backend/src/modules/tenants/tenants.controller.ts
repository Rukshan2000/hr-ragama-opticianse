import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendSuccess } from '../../shared/utils/response';
import type {
  CreateTenantBody,
  ListTenantsQuery,
  TenantIdParams,
  UpdateTenantBody,
} from './tenants.schema';
import { tenantsService } from './tenants.service';

export const tenantsController = {
  async list(req: FastifyRequest<{ Querystring: ListTenantsQuery }>, reply: FastifyReply) {
    const { items, meta } = await tenantsService.list(req.query);
    return sendSuccess(reply, items, { meta });
  },

  async get(req: FastifyRequest<{ Params: TenantIdParams }>, reply: FastifyReply) {
    return sendSuccess(reply, await tenantsService.get(req.params.id));
  },

  async create(req: FastifyRequest<{ Body: CreateTenantBody }>, reply: FastifyReply) {
    const tenant = await tenantsService.create(req.body);
    return sendSuccess(reply, tenant, { statusCode: 201, message: 'Tenant created' });
  },

  async update(
    req: FastifyRequest<{ Params: TenantIdParams; Body: UpdateTenantBody }>,
    reply: FastifyReply,
  ) {
    const tenant = await tenantsService.update(req.params.id, req.body);
    return sendSuccess(reply, tenant, { message: 'Tenant updated' });
  },

  async remove(req: FastifyRequest<{ Params: TenantIdParams }>, reply: FastifyReply) {
    await tenantsService.remove(req.params.id);
    return sendSuccess(reply, null, { message: 'Tenant deleted' });
  },
};
