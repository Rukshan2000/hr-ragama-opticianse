import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from '../../config/env';
import { sendSuccess } from '../../shared/utils/response';
import { authenticate } from './auth.guard';
import { mfaService } from './mfa.service';

const tags = ['MFA'];
const secured = [{ bearerAuth: [] }];
const strict = { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } };

const mfaToken = z.string().min(20).max(200);
const password = z.object({ currentPassword: z.string().min(1).max(128) });
const factor = z.enum(['totp', 'email', 'passkey']);
const assertion = z.looseObject({
  id: z.string().min(1).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal('public-key'),
  response: z.looseObject({ clientDataJSON: z.string().max(16_384) }),
  clientExtensionResults: z.looseObject({}).default({}),
});

const client = (req: FastifyRequest) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });
const audit = (req: FastifyRequest, event: string, data: object) =>
  req.log.info({ audit: event, ip: req.ip, ...data }, event);

export const mfaRoutes: FastifyPluginAsyncZod = async (app) => {
  // ---- Login second step (public; authorised by the mfaToken from /auth/login) ----
  app.post(
    '/verify',
    {
      config: strict,
      schema: {
        tags,
        summary: 'Complete sign-in with a second factor',
        body: z.object({
          mfaToken,
          method: z.enum(['totp', 'email', 'passkey', 'recovery']),
          code: z.string().trim().min(1).max(32).optional(),
          response: assertion.optional(),
        }),
      },
    },
    async (req, reply) => {
      try {
        const r = await mfaService.verify(
          {
            ...req.body,
            response: req.body.response as unknown as AuthenticationResponseJSON | undefined,
          },
          client(req),
        );
        audit(req, 'mfa.verified', { userId: r.userId, method: req.body.method });
        return sendSuccess(reply, r.session, { message: 'Login successful' });
      } catch (err) {
        audit(req, 'mfa.failed', { method: req.body.method });
        throw err;
      }
    },
  );
  app.post(
    '/challenge/email',
    {
      config: strict,
      schema: { tags, summary: 'Email a sign-in code', body: z.object({ mfaToken }) },
    },
    async (req, reply) => {
      await mfaService.sendEmailCode(req.body.mfaToken);
      return sendSuccess(reply, null, { message: 'Code sent' });
    },
  );
  app.post(
    '/challenge/passkey',
    {
      config: strict,
      schema: {
        tags,
        summary: 'Passkey options for the second step',
        body: z.object({ mfaToken }),
      },
    },
    async (req, reply) => sendSuccess(reply, await mfaService.passkeyOptions(req.body.mfaToken)),
  );

  // ---- Management (authenticated) ----
  const auth = { preHandler: authenticate };
  app.get(
    '/',
    { ...auth, schema: { tags, summary: 'My 2-step verification status', security: secured } },
    async (req, reply) => sendSuccess(reply, await mfaService.status(req.auth!.userId)),
  );
  app.post(
    '/totp/setup',
    {
      ...auth,
      config: strict,
      schema: { tags, summary: 'Start authenticator app setup', security: secured, body: password },
    },
    async (req, reply) =>
      sendSuccess(reply, await mfaService.totpSetup(req.auth!.userId, req.body.currentPassword)),
  );
  app.post(
    '/totp/enable',
    {
      ...auth,
      config: strict,
      schema: {
        tags,
        summary: 'Confirm authenticator app with a code',
        security: secured,
        body: z.object({
          code: z
            .string()
            .trim()
            .regex(/^\d{6}$/),
        }),
      },
    },
    async (req, reply) => {
      const data = await mfaService.totpEnable(req.auth!.userId, req.body.code);
      audit(req, 'mfa.enabled', { userId: req.auth!.userId, method: 'totp' });
      return sendSuccess(reply, data, { message: 'Authenticator app enabled' });
    },
  );
  app.post(
    '/:factor/enable',
    {
      ...auth,
      config: strict,
      schema: {
        tags,
        summary: 'Enable email or passkey as a second factor',
        security: secured,
        params: z.object({ factor: z.enum(['email', 'passkey']) }),
        body: password,
      },
    },
    async (req, reply) => {
      const data = await mfaService.enable(
        req.auth!.userId,
        req.params.factor,
        req.body.currentPassword,
      );
      audit(req, 'mfa.enabled', { userId: req.auth!.userId, method: req.params.factor });
      return sendSuccess(reply, data, { message: 'Enabled' });
    },
  );
  app.post(
    '/:factor/disable',
    {
      ...auth,
      config: strict,
      schema: {
        tags,
        summary: 'Disable a second factor',
        security: secured,
        params: z.object({ factor }),
        body: password,
      },
    },
    async (req, reply) => {
      await mfaService.disable(req.auth!.userId, req.params.factor, req.body.currentPassword);
      audit(req, 'mfa.disabled', { userId: req.auth!.userId, method: req.params.factor });
      return sendSuccess(reply, null, { message: 'Disabled' });
    },
  );
  app.post(
    '/recovery-codes',
    {
      ...auth,
      config: strict,
      schema: { tags, summary: 'Regenerate recovery codes', security: secured, body: password },
    },
    async (req, reply) => {
      const data = await mfaService.regenerateRecoveryCodes(
        req.auth!.userId,
        req.body.currentPassword,
      );
      audit(req, 'mfa.recovery_regenerated', { userId: req.auth!.userId });
      return sendSuccess(reply, data, { message: 'New recovery codes generated' });
    },
  );
};
