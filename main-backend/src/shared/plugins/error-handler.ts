import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError } from '../errors/app-error';

export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const meta = { requestId: request.id };

    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(422).send({
        success: false,
        message: 'Validation failed',
        errors: error.validation.map((v) => ({
          // instancePath is "/a/b" for nested fields; prefix with the part (body, querystring...).
          field: [error.validationContext, ...v.instancePath.split('/').filter(Boolean)].join('.'),
          message: v.message ?? 'Invalid value',
        })),
        meta,
      });
    }

    if (error instanceof AppError) {
      if (error.statusCode >= 500) request.log.error({ err: error }, error.message);
      return reply
        .status(error.statusCode)
        .send({ success: false, message: error.message, errors: error.errors, meta });
    }

    // Framework errors with a client status (malformed JSON, body too large, unsupported media...).
    const status = error.statusCode ?? 500;
    if (status < 500) {
      return reply
        .status(status)
        .send({ success: false, message: error.message, errors: [], meta });
    }

    // Never leak internals (SQL, stack traces, driver messages) to clients.
    request.log.error({ err: error }, 'Unhandled error');
    return reply
      .status(500)
      .send({ success: false, message: 'Internal server error', errors: [], meta });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      success: false,
      message: `Route ${request.method} ${request.url.split('?')[0]} not found`,
      errors: [],
      meta: { requestId: request.id },
    }),
  );
}
