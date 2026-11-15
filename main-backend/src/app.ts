import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { appConfig } from './config/app.config';
import { env } from './config/env';
import { loggerConfig } from './config/logger';
import { authRoutes } from './modules/auth/auth.routes';
import { employeesRoutes } from './modules/employees/employees.routes';
import { hrRoutes } from './modules/hr-routes';
import { healthRoutes } from './modules/health/health.routes';
import { organizationRoutes } from './modules/organization/organization.routes';
import { permissionsRoutes } from './modules/permissions/permissions.routes';
import { rolesRoutes } from './modules/roles/roles.routes';
import { tenantsRoutes } from './modules/tenants/tenants.routes';
import { usersRoutes } from './modules/users/users.routes';
import { isHubManaged } from './modules/auth/hub-sync';
import { verifyAccessToken } from './modules/auth/token.service';
import { ConflictError } from './shared/errors/app-error';
import { registerErrorHandlers } from './shared/plugins/error-handler';
import { registerSecurity } from './shared/plugins/security';
import { registerSwagger } from './shared/plugins/swagger';

const REQUEST_ID = /^[\w.:-]{1,128}$/;

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerConfig,
    bodyLimit: env.BODY_LIMIT_BYTES,
    trustProxy: env.TRUST_PROXY,
    // Propagate a sane upstream x-request-id (e.g. from Nginx), otherwise generate one.
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    },
    routerOptions: { ignoreTrailingSlash: true },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  // Organizations managed by InvoHub: users, roles and shared organization data are edited there.
  const HUB_OWNED = /^\/api\/v1\/(users|roles|organization\/(branches|departments|designations|levels))/;
  app.addHook('preHandler', async (req) => {
    if (req.method === 'GET' || !HUB_OWNED.test(req.url.split('?')[0]!)) return;
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return; // the route's own guard rejects it
    let tid: string | null;
    try {
      tid = verifyAccessToken(auth.slice(7)).tid;
    } catch {
      return;
    }
    if (tid && (await isHubManaged(tid)))
      throw new ConflictError('This is managed in InvoHub. Make the change there.');
  });

  registerErrorHandlers(app);
  await registerSecurity(app);
  if (appConfig.swaggerEnabled) await registerSwagger(app);

  await app.register(
    async (api) => {
      await api.register(healthRoutes, { prefix: '/health' });
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(usersRoutes, { prefix: '/users' });
      await api.register(rolesRoutes, { prefix: '/roles' });
      await api.register(permissionsRoutes, { prefix: '/permissions' });
      await api.register(tenantsRoutes, { prefix: '/tenants' });
      await api.register(organizationRoutes, { prefix: '/organization' });
      await api.register(employeesRoutes, { prefix: '/employees' });
      await api.register(hrRoutes);
    },
    { prefix: appConfig.apiPrefix },
  );

  return app;
}
