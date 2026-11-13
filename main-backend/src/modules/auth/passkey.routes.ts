import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from '../../config/env';
import { sendSuccess } from '../../shared/utils/response';
import { authenticate } from './auth.guard';
import { passkeyService, toPasskeyDto } from './passkey.service';

const tags = ['Passkeys'];
const secured = [{ bearerAuth: [] }];
const strict = { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } };

// Shape-checked only; the cryptographic content is verified by SimpleWebAuthn.
const credential = z.looseObject({
  id: z.string().min(1).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal('public-key'),
  response: z.looseObject({ clientDataJSON: z.string().max(16_384) }),
  clientExtensionResults: z.looseObject({}).default({}),
});
const deviceName = z.string().trim().min(1).max(100);
const idParams = z.object({ id: z.uuid() });

const client = (req: FastifyRequest) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });
const audit = (req: FastifyRequest, event: string, data: object) =>
  req.log.info({ audit: event, ip: req.ip, ...data }, event);

export const passkeyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/register/options',
    {
      config: strict,
      preHandler: authenticate,
      schema: { tags, summary: 'Start passkey registration', security: secured },
    },
    async (req, reply) =>
      sendSuccess(reply, await passkeyService.registrationOptions(req.auth!.userId)),
  );

  app.post(
    '/register/verify',
    {
      config: strict,
      preHandler: authenticate,
      schema: {
        tags,
        summary: 'Finish passkey registration',
        security: secured,
        body: z.object({
          challengeId: z.uuid(),
          response: credential,
          deviceName: deviceName.optional(),
        }),
      },
    },
    async (req, reply) => {
      const userId = req.auth!.userId;
      try {
        const row = await passkeyService.verifyRegistration(userId, {
          ...req.body,
          response: req.body.response as unknown as RegistrationResponseJSON,
        });
        audit(req, 'passkey.registered', { userId, passkeyId: row.id });
        return sendSuccess(reply, toPasskeyDto(row), { statusCode: 201, message: 'Passkey added' });
      } catch (err) {
        audit(req, 'passkey.register_failed', { userId });
        throw err;
      }
    },
  );

  app.post(
    '/login/options',
    {
      config: strict,
      schema: {
        tags,
        summary: 'Start passkey sign-in (email optional for discoverable login)',
        body: z
          .object({
            email: z
              .email()
              .max(255)
              .transform((e) => e.toLowerCase())
              .optional(),
          })
          .default({}),
      },
    },
    async (req, reply) => sendSuccess(reply, await passkeyService.loginOptions(req.body.email)),
  );

  app.post(
    '/login/verify',
    {
      config: strict,
      schema: {
        tags,
        summary: 'Finish passkey sign-in',
        body: z.object({
          challengeId: z.uuid(),
          response: credential,
          tenantSlug: z.string().trim().min(1).max(100).optional(),
        }),
      },
    },
    async (req, reply) => {
      try {
        const r = await passkeyService.verifyLogin(
          { ...req.body, response: req.body.response as unknown as AuthenticationResponseJSON },
          client(req),
        );
        audit(req, 'passkey.login', { userId: r.userId, passkeyId: r.passkeyId });
        return sendSuccess(reply, r.session, { message: 'Login successful' });
      } catch (err) {
        audit(req, 'passkey.login_failed', {});
        throw err;
      }
    },
  );

  app.get(
    '/',
    { preHandler: authenticate, schema: { tags, summary: 'List my passkeys', security: secured } },
    async (req, reply) => sendSuccess(reply, await passkeyService.list(req.auth!.userId)),
  );

  app.patch(
    '/:id',
    {
      preHandler: authenticate,
      schema: {
        tags,
        summary: 'Rename a passkey',
        security: secured,
        params: idParams,
        body: z.object({ deviceName }),
      },
    },
    async (req, reply) =>
      sendSuccess(
        reply,
        await passkeyService.rename(req.auth!.userId, req.params.id, req.body.deviceName),
        { message: 'Passkey renamed' },
      ),
  );

  app.delete(
    '/:id',
    {
      config: strict,
      preHandler: authenticate,
      schema: {
        tags,
        summary: 'Remove a passkey (requires current password)',
        security: secured,
        params: idParams,
        body: z.object({ currentPassword: z.string().min(1).max(128) }),
      },
    },
    async (req, reply) => {
      const userId = req.auth!.userId;
      await passkeyService.remove(userId, req.params.id, req.body.currentPassword);
      audit(req, 'passkey.removed', { userId, passkeyId: req.params.id });
      return sendSuccess(reply, null, { message: 'Passkey removed' });
    },
  );
};
