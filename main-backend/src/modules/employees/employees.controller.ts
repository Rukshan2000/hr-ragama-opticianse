import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendSuccess } from '../../shared/utils/response';
import type {
  AssignmentBody,
  CreateEmployeeBody,
  IdParams,
  ListEmployeesQuery,
  StatusBody,
  UpdateEmployeeBody,
} from './employees.schema';
import { employeesService as s } from './employees.service';

type Req<P = unknown, B = unknown> = FastifyRequest<{ Params: P; Body: B }>;

export const employeesController = {
  async list(req: FastifyRequest<{ Querystring: ListEmployeesQuery }>, reply: FastifyReply) {
    const { items, meta } = await s.list(req.auth!, req.query);
    return sendSuccess(reply, items, { meta });
  },
  async get(req: Req<IdParams>, reply: FastifyReply) {
    return sendSuccess(reply, await s.get(req.auth!, req.params.id));
  },
  async create(req: Req<unknown, CreateEmployeeBody>, reply: FastifyReply) {
    return sendSuccess(reply, await s.create(req.auth!, req.body), {
      statusCode: 201,
      message: 'Employee created',
    });
  },
  async update(req: Req<IdParams, UpdateEmployeeBody>, reply: FastifyReply) {
    return sendSuccess(reply, await s.update(req.auth!, req.params.id, req.body), {
      message: 'Employee updated',
    });
  },
  async assignment(req: Req<IdParams, AssignmentBody>, reply: FastifyReply) {
    return sendSuccess(reply, await s.changeAssignment(req.auth!, req.params.id, req.body), {
      message: 'Assignment updated',
    });
  },
  async status(req: Req<IdParams, StatusBody>, reply: FastifyReply) {
    return sendSuccess(reply, await s.changeStatus(req.auth!, req.params.id, req.body), {
      message: 'Status updated',
    });
  },
  async history(req: Req<IdParams>, reply: FastifyReply) {
    return sendSuccess(reply, await s.history(req.auth!, req.params.id));
  },
  async remove(req: Req<IdParams>, reply: FastifyReply) {
    await s.remove(req.auth!, req.params.id);
    return sendSuccess(reply, null, { message: 'Employee archived' });
  },
};
