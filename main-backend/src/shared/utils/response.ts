import type { FastifyReply } from 'fastify';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function sendSuccess<T>(
  reply: FastifyReply,
  data: T,
  { message = 'Operation completed successfully', statusCode = 200, meta = null as unknown } = {},
) {
  return reply.status(statusCode).send({ success: true, message, data, meta });
}
