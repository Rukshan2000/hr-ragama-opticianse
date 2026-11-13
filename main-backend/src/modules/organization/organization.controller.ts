import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ListQuery } from '../../shared/utils/pagination';
import { sendSuccess } from '../../shared/utils/response';
import type { IdParams, UnitBody, UnitPatch } from './organization.schema';
import type { branchesService } from './organization.service';
import { unitsService } from './organization.service';

type MasterService = Pick<typeof branchesService, 'list' | 'get' | 'create' | 'update' | 'remove'>;
type Req<P = unknown, Q = unknown, B = unknown> = FastifyRequest<{
  Params: P;
  Querystring: Q;
  Body: B;
}>;

export function masterController(service: MasterService, label: string) {
  return {
    async list(req: Req<unknown, ListQuery & { isActive?: boolean }>, reply: FastifyReply) {
      const { items, meta } = await service.list(req.auth!, req.query);
      return sendSuccess(reply, items, { meta });
    },
    async get(req: Req<IdParams>, reply: FastifyReply) {
      return sendSuccess(reply, await service.get(req.auth!, req.params.id));
    },
    async create(req: Req<unknown, unknown, object>, reply: FastifyReply) {
      const row = await service.create(req.auth!, req.body as object);
      return sendSuccess(reply, row, { statusCode: 201, message: `${label} created` });
    },
    async update(req: Req<IdParams, unknown, object>, reply: FastifyReply) {
      return sendSuccess(
        reply,
        await service.update(req.auth!, req.params.id, req.body as object),
        {
          message: `${label} updated`,
        },
      );
    },
    async remove(req: Req<IdParams>, reply: FastifyReply) {
      await service.remove(req.auth!, req.params.id);
      return sendSuccess(reply, null, { message: `${label} deleted` });
    },
  };
}

export const unitsController = {
  async list(req: FastifyRequest, reply: FastifyReply) {
    return sendSuccess(reply, await unitsService.list(req.auth!));
  },
  async get(req: Req<IdParams>, reply: FastifyReply) {
    return sendSuccess(reply, await unitsService.get(req.auth!, req.params.id));
  },
  async create(req: Req<unknown, unknown, UnitBody>, reply: FastifyReply) {
    const unit = await unitsService.create(req.auth!, req.body);
    return sendSuccess(reply, unit, { statusCode: 201, message: 'Unit created' });
  },
  async update(req: Req<IdParams, unknown, UnitPatch>, reply: FastifyReply) {
    const unit = await unitsService.update(req.auth!, req.params.id, req.body);
    return sendSuccess(reply, unit, { message: 'Unit updated' });
  },
  async remove(req: Req<IdParams>, reply: FastifyReply) {
    await unitsService.remove(req.auth!, req.params.id);
    return sendSuccess(reply, null, { message: 'Unit deleted' });
  },
};
