import type { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { appConfig } from '../../config/app.config';
import { env } from '../../config/env';
import { TooManyRequestsError } from '../errors/app-error';

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    // Swagger UI needs inline scripts/styles; the API itself serves JSON only.
    contentSecurityPolicy: appConfig.swaggerEnabled ? false : undefined,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  await app.register(cors, {
    origin: appConfig.corsOrigins.includes('*') ? true : appConfig.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['x-request-id'],
    maxAge: 600,
  });

  // ponytail: in-memory store, per instance. Pass a Redis client via `redis` when running >1 replica.
  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    errorResponseBuilder: (_req, ctx) =>
      new TooManyRequestsError(`Rate limit exceeded, retry in ${ctx.after}`),
  });
}
