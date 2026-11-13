import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { checkDatabase } from '../../database/knex';
import { sendSuccess } from '../../shared/utils/response';

const tags = ['Health'];

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  // Liveness: the process is up. Never touches dependencies, so a DB blip doesn't restart pods.
  app.get(
    '/',
    { logLevel: 'warn', config: { rateLimit: false }, schema: { tags, summary: 'Liveness probe' } },
    async (_req, reply) =>
      sendSuccess(reply, { status: 'ok', uptime: Math.round(process.uptime()) }),
  );

  // Readiness: can we actually serve traffic (DB reachable)?
  app.get(
    '/ready',
    {
      logLevel: 'warn',
      config: { rateLimit: false },
      schema: { tags, summary: 'Readiness probe' },
    },
    async (req, reply) => {
      try {
        await checkDatabase();
        return sendSuccess(reply, { status: 'ready', database: 'up' });
      } catch (err) {
        req.log.error({ err }, 'Readiness check failed: database unreachable');
        return reply.status(503).send({
          success: false,
          message: 'Service not ready',
          errors: [{ field: 'database', message: 'unreachable' }],
          meta: { requestId: req.id },
        });
      }
    },
  );
};
