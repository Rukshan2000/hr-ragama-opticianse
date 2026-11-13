import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { sendSuccess } from '../../shared/utils/response';
import { authenticate } from '../auth/auth.guard';
import { idParams } from '../hr-common/crud';
import { NOTIFICATION_TYPES, notificationsService as s } from './notifications.service';

const tags = ['Notifications'];
const security = [{ bearerAuth: [] }];

/** Every signed-in member can read their own notifications; rows are filtered by user_id. */
export const notificationsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', authenticate);
  app.get(
    '/',
    {
      schema: {
        tags,
        security,
        summary: 'My notifications',
        querystring: z.object({
          unread: z
            .enum(['true', 'false'])
            .transform((v) => v === 'true')
            .optional(),
          limit: z.coerce.number().int().min(1).max(100).default(30),
        }),
      },
    },
    async (req, reply) => sendSuccess(reply, await s.list(req.auth!, req.query)),
  );
  app.post('/:id/read', { schema: { tags, security, params: idParams } }, async (req, reply) => {
    await s.markRead(req.auth!, req.params.id);
    return sendSuccess(reply, null, { message: 'Marked as read' });
  });
  app.post('/read-all', { schema: { tags, security } }, async (req, reply) => {
    await s.markAllRead(req.auth!);
    return sendSuccess(reply, null, { message: 'All marked as read' });
  });
  app.get('/preferences', { schema: { tags, security } }, async (req, reply) =>
    sendSuccess(reply, await s.preferences(req.auth!)),
  );
  app.put(
    '/preferences',
    {
      schema: {
        tags,
        security,
        body: z.object({
          preferences: z
            .array(
              z.object({
                type: z.enum(NOTIFICATION_TYPES),
                inApp: z.boolean(),
                email: z.boolean(),
              }),
            )
            .max(NOTIFICATION_TYPES.length),
        }),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await s.setPreferences(req.auth!, req.body.preferences)),
  );
};
