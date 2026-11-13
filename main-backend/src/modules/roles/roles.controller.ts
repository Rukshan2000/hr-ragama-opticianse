import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendSuccess } from '../../shared/utils/response';
import type { CreateRoleBody, ListRolesQuery, RoleIdParams, UpdateRoleBody } from './roles.schema';
import { rolesService } from './roles.service';

export const rolesController = {
  async list(req: FastifyRequest<{ Querystring: ListRolesQuery }>, reply: FastifyReply) {
    const { items, meta } = await rolesService.list(req.auth!, req.query);
    return sendSuccess(reply, items, { meta });
  },

  async get(req: FastifyRequest<{ Params: RoleIdParams }>, reply: FastifyReply) {
    return sendSuccess(reply, await rolesService.get(req.auth!, req.params.id));
  },

  async create(req: FastifyRequest<{ Body: CreateRoleBody }>, reply: FastifyReply) {
    const role = await rolesService.create(req.auth!, req.body);
    return sendSuccess(reply, role, { statusCode: 201, message: 'Role created' });
  },

  async update(
    req: FastifyRequest<{ Params: RoleIdParams; Body: UpdateRoleBody }>,
    reply: FastifyReply,
  ) {
    const role = await rolesService.update(req.auth!, req.params.id, req.body);
    return sendSuccess(reply, role, { message: 'Role updated' });
  },

  async remove(req: FastifyRequest<{ Params: RoleIdParams }>, reply: FastifyReply) {
    await rolesService.remove(req.auth!, req.params.id);
    return sendSuccess(reply, null, { message: 'Role deleted' });
  },
};
