import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { appConfig } from '../../config/app.config';
import { env } from '../../config/env';
import { authController as c } from './auth.controller';
import { authenticate } from './auth.guard';
import * as s from './auth.schema';
import { mfaRoutes } from './mfa.routes';
import { passkeyRoutes } from './passkey.routes';

const tags = ['Auth'];
const secured = [{ bearerAuth: [] }];
// Stricter per-IP limit on credential endpoints, on top of the account lockout.
const strict = { rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' } };

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  await app.register(passkeyRoutes, { prefix: '/passkeys' });
  await app.register(mfaRoutes, { prefix: '/mfa' });
  app.post(
    '/register',
    {
      config: strict,
      schema: { tags, summary: 'Register user and organization', body: s.registerBody },
    },
    c.register,
  );
  app.post(
    '/login',
    { config: strict, schema: { tags, summary: 'Log in', body: s.loginBody } },
    c.login,
  );
  app.post(
    '/refresh',
    { config: strict, schema: { tags, summary: 'Rotate refresh token', body: s.refreshBody } },
    c.refresh,
  );
  app.post(
    '/logout',
    { schema: { tags, summary: 'Revoke current session', body: s.refreshBody } },
    c.logout,
  );
  app.post(
    '/forgot-password',
    {
      config: strict,
      schema: { tags, summary: 'Request password reset', body: s.forgotPasswordBody },
    },
    c.forgotPassword,
  );
  app.post(
    '/reset-password',
    {
      config: strict,
      schema: { tags, summary: 'Reset password with token', body: s.resetPasswordBody },
    },
    c.resetPassword,
  );

  app.get(
    '/me',
    {
      preHandler: authenticate,
      schema: { tags, summary: 'Current user profile', security: secured },
    },
    c.me,
  );
  app.post(
    '/logout-all',
    {
      preHandler: authenticate,
      schema: { tags, summary: 'Revoke all sessions', security: secured },
    },
    c.logoutAll,
  );
  if (!appConfig.tenancy.single)
    app.post(
      '/switch-tenant',
      {
        preHandler: authenticate,
        schema: {
          tags,
          summary: 'Get tokens for another tenant',
          security: secured,
          body: s.switchTenantBody,
        },
      },
      c.switchTenant,
    );
  app.post(
    '/change-password',
    {
      config: strict,
      preHandler: authenticate,
      schema: { tags, summary: 'Change password', security: secured, body: s.changePasswordBody },
    },
    c.changePassword,
  );
};
