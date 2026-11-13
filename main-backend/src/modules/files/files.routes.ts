import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from '../../config/env';
import { PERMISSIONS as P } from '../../shared/constants/permissions';
import { BadRequestError } from '../../shared/errors/app-error';
import { sendSuccess } from '../../shared/utils/response';
import { authenticate, requirePermissions } from '../auth/auth.guard';
import { idParams, isoDate, text } from '../hr-common/crud';
import { documentsService, filesService, FILE_PURPOSES, type FilePurpose } from './files.service';

const tags = ['Files & documents'];
const security = [{ bearerAuth: [] }];
const DOCUMENT_CATEGORIES = [
  'identity',
  'education',
  'certificate',
  'contract',
  'medical',
  'other',
] as const;

/** Content-Disposition with an ASCII fallback and RFC 5987 UTF-8 name. */
const disposition = (name: string, inline: boolean) =>
  `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

export const filesRoutes: FastifyPluginAsyncZod = async (app) => {
  // Raw binary upload (no multipart dependency): body = file bytes, metadata in the query.
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: env.UPLOAD_MAX_BYTES },
    (_req, body, done) => done(null, body),
  );

  app.post(
    '/files',
    {
      preHandler: authenticate,
      bodyLimit: env.UPLOAD_MAX_BYTES,
      schema: {
        tags,
        security,
        summary: 'Upload a private file (application/octet-stream)',
        querystring: z.object({
          filename: z.string().trim().min(1).max(255),
          purpose: z.enum(Object.keys(FILE_PURPOSES) as [FilePurpose, ...FilePurpose[]]),
          employeeId: z.uuid().optional(),
        }),
      },
    },
    async (req, reply) => {
      if (!Buffer.isBuffer(req.body))
        throw new BadRequestError('Send the file as application/octet-stream');
      const file = await filesService.upload(req.auth!, { ...req.query, data: req.body });
      return sendSuccess(reply, file, { statusCode: 201, message: 'File uploaded' });
    },
  );

  app.get(
    '/files/:id/content',
    {
      preHandler: authenticate,
      schema: {
        tags,
        security,
        summary: 'Download a file (authorized)',
        params: idParams,
        querystring: z.object({ inline: z.enum(['true', 'false']).optional() }),
      },
    },
    async (req, reply) => {
      const { file, data } = await filesService.download(req.auth!, req.params.id);
      const inline =
        req.query.inline === 'true' && /^(image\/|application\/pdf)/.test(file.mime_type);
      return reply
        .header('content-type', file.mime_type)
        .header('content-disposition', disposition(file.original_name, inline))
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(data);
    },
  );

  // ── Employee documents ──
  app.get(
    '/documents',
    {
      preHandler: requirePermissions(P.DOCUMENTS_READ),
      schema: {
        tags,
        security,
        summary: 'All employee documents',
        querystring: z.object({
          search: z.string().trim().min(1).max(100).optional(),
          category: z.enum(DOCUMENT_CATEGORIES).optional(),
          expiringWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
        }),
      },
    },
    async (req, reply) => sendSuccess(reply, await documentsService.listAll(req.auth!, req.query)),
  );
  app.get(
    '/employees/:id/documents',
    { preHandler: authenticate, schema: { tags, security, params: idParams } },
    async (req, reply) => sendSuccess(reply, await documentsService.list(req.auth!, req.params.id)),
  );
  app.post(
    '/employees/:id/documents',
    {
      preHandler: authenticate,
      schema: {
        tags,
        security,
        params: idParams,
        body: z.object({
          fileId: z.uuid(),
          category: z.enum(DOCUMENT_CATEGORIES),
          title: z.string().trim().min(1).max(150),
          expiryDate: isoDate.nullish(),
          notes: text(500),
        }),
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await documentsService.create(req.auth!, req.params.id, req.body), {
        statusCode: 201,
        message: 'Document added',
      }),
  );
  app.delete(
    '/documents/:id',
    {
      preHandler: requirePermissions(P.DOCUMENTS_MANAGE),
      schema: { tags, security, params: idParams },
    },
    async (req, reply) => {
      await documentsService.remove(req.auth!, req.params.id);
      return sendSuccess(reply, null, { message: 'Document deleted' });
    },
  );
  app.put(
    '/employees/:id/photo',
    {
      preHandler: authenticate,
      schema: { tags, security, params: idParams, body: z.object({ fileId: z.uuid().nullable() }) },
    },
    async (req, reply) =>
      sendSuccess(
        reply,
        await documentsService.setPhoto(req.auth!, req.params.id, req.body.fileId),
        {
          message: 'Photo updated',
        },
      ),
  );
};
