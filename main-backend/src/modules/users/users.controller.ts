import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendSuccess } from '../../shared/utils/response';
import type {
  CreateUserBody,
  ListUsersQuery,
  UpdateUserBody,
  UserIdParams,
  UserStatusBody,
} from './users.schema';
import { usersService } from './users.service';

export const usersController = {
  async list(req: FastifyRequest<{ Querystring: ListUsersQuery }>, reply: FastifyReply) {
    const { items, meta } = await usersService.list(req.auth!, req.query);
    return sendSuccess(reply, items, { meta });
  },

  async get(req: FastifyRequest<{ Params: UserIdParams }>, reply: FastifyReply) {
    return sendSuccess(reply, await usersService.get(req.auth!, req.params.id));
  },

  async create(req: FastifyRequest<{ Body: CreateUserBody }>, reply: FastifyReply) {
    const user = await usersService.create(req.auth!, req.body);
    return sendSuccess(reply, user, { statusCode: 201, message: 'User created' });
  },

  async update(
    req: FastifyRequest<{ Params: UserIdParams; Body: UpdateUserBody }>,
    reply: FastifyReply,
  ) {
    const user = await usersService.update(req.auth!, req.params.id, req.body);
    return sendSuccess(reply, user, { message: 'User updated' });
  },

  async setStatus(
    req: FastifyRequest<{ Params: UserIdParams; Body: UserStatusBody }>,
    reply: FastifyReply,
  ) {
    const user = await usersService.setStatus(req.auth!, req.params.id, req.body.isActive);
    return sendSuccess(reply, user, {
      message: req.body.isActive ? 'User activated' : 'User deactivated',
    });
  },

  async remove(req: FastifyRequest<{ Params: UserIdParams }>, reply: FastifyReply) {
    await usersService.remove(req.auth!, req.params.id);
    return sendSuccess(reply, null, { message: 'User removed' });
  },
};
