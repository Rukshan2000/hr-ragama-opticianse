import type { FastifyInstance, FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';
import type { Knex } from 'knex';
import { z } from 'zod';
import { db, withTransaction, type DbExecutor } from '../../database/knex';
import type { Permission } from '../../shared/constants/permissions';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors/app-error';
import type { AuthContext } from '../../shared/types/auth';
import { toCamel, toSnake } from '../../shared/utils/case';
import {
  isCheckViolation,
  isForeignKeyViolation,
  isUniqueViolation,
} from '../../shared/utils/db-errors';
import { likeTerm, paginate } from '../../shared/utils/pagination';
import { sendSuccess } from '../../shared/utils/response';
import { nextCode } from '../../shared/utils/next-code';
import { requireTenantId, tenantScope } from '../../shared/utils/tenant-scope';
import { requirePermissions } from '../auth/auth.guard';
import { audit } from './audit';

export const idParams = z.object({ id: z.uuid() });
export type Row = Record<string, unknown> & { id: string };

/** Maps constraint violations to actionable API errors. */
export async function dbGuard<T>(
  label: string,
  fn: () => Promise<T>,
  onDelete = false,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isUniqueViolation(err))
      throw new ConflictError(`A ${label} with these details already exists`);
    if (isForeignKeyViolation(err)) {
      if (onDelete)
        throw new ConflictError(
          `This ${label} is in use and cannot be deleted. Deactivate it instead`,
        );
      throw new BadRequestError('A referenced record does not exist');
    }
    if ((err as { code?: string }).code === '23P01')
      throw new ConflictError(`This ${label} overlaps an existing one`);
    if (isCheckViolation(err)) throw new BadRequestError('Some values are invalid or inconsistent');
    throw err;
  }
}

export interface CrudConfig {
  /** Fixed table name (never client input) and alias used in `select`. */
  table: string;
  label: string;
  tag: string;
  read: Permission;
  manage: Permission;
  create: z.ZodType<object>;
  patch: z.ZodType<object>;
  /** Extra list filters: query key → column (equality). */
  filters?: Record<string, { column: string; schema: z.ZodType }>;
  search?: string[];
  sort: Record<string, string>;
  defaultSort: string;
  defaultOrder?: 'asc' | 'desc';
  /** Adds joins/selects to the base query (alias `x`). */
  select?: (q: Knex.QueryBuilder) => void;
  /** Business validation before insert/update (inside the transaction). */
  beforeWrite?: (
    ctx: { auth: AuthContext; tenantId: string; trx: DbExecutor },
    data: Record<string, unknown>,
    existing?: Row,
  ) => Promise<void>;
  /** Blocks deletes (e.g. "only drafts can be deleted"). */
  beforeDelete?: (existing: Row) => void;
  /** Sensitive resources record create/update/delete in the audit log. */
  audited?: boolean;
  noDelete?: boolean;
  /** Blank `code` on create is generated as "<PREFIX>-NNN"; also exposes GET <path>/next-code. */
  codePrefix?: string;
}

/**
 * Repository + service + routes for a flat tenant-owned resource. Used for master data and
 * simple records; workflows and calculations live in their own module services.
 */
export function crudResource(cfg: CrudConfig) {
  const alias = `${cfg.table} as x`;
  const base = (executor: DbExecutor, tenantId: string) => {
    const q = tenantScope(executor, alias, tenantId).select('x.*');
    cfg.select?.(q);
    return q;
  };

  const repo = {
    list(tenantId: string, q: Record<string, unknown>) {
      const qb = base(db, tenantId).modify((b) => {
        if (q.search && cfg.search?.length) {
          const term = likeTerm(String(q.search));
          b.where((w) => cfg.search!.forEach((c) => w.orWhereILike(c, term)));
        }
        for (const [key, f] of Object.entries(cfg.filters ?? {}))
          if (q[key] !== undefined) b.where(f.column, q[key] as string);
      });
      return paginate<Row>(qb, q as { page: number; limit: number }, {
        column: cfg.sort[q.sort as string]!,
        order: q.order as 'asc' | 'desc',
      });
    },
    find: (tenantId: string, id: string, ex: DbExecutor = db) =>
      base(ex, tenantId).where('x.id', id).first() as Promise<Row | undefined>,
    lock: (tenantId: string, id: string, ex: DbExecutor) =>
      tenantScope(ex, cfg.table, tenantId).where({ id }).forUpdate().first() as Promise<
        Row | undefined
      >,
  };

  const service = {
    async list(auth: AuthContext, q: Record<string, unknown>) {
      const { items, meta } = await repo.list(requireTenantId(auth), q);
      return { items: items.map(toCamel), meta };
    },
    async get(auth: AuthContext, id: string) {
      const row = await repo.find(requireTenantId(auth), id);
      if (!row) throw new NotFoundError(cfg.label);
      return toCamel(row);
    },
    async create(auth: AuthContext, input: object) {
      const tenantId = requireTenantId(auth);
      const id = await dbGuard(cfg.label.toLowerCase(), () =>
        withTransaction(async (trx) => {
          const data = toSnake(input);
          // ponytail: concurrent auto-codes can collide → 409 via unique index; user retries.
          if (cfg.codePrefix && !data.code)
            data.code = await nextCode(trx, cfg.table, tenantId, cfg.codePrefix);
          await cfg.beforeWrite?.({ auth, tenantId, trx }, data);
          const [row] = await trx(cfg.table)
            .insert({ ...data, tenant_id: tenantId })
            .returning<{ id: string }[]>('id');
          if (cfg.audited) await audit(trx, auth, `${cfg.table}.create`, cfg.table, row!.id, data);
          return row!.id;
        }),
      );
      return service.get(auth, id);
    },
    async update(auth: AuthContext, id: string, input: object) {
      const tenantId = requireTenantId(auth);
      await dbGuard(cfg.label.toLowerCase(), () =>
        withTransaction(async (trx) => {
          const existing = await repo.lock(tenantId, id, trx);
          if (!existing) throw new NotFoundError(cfg.label);
          const data = toSnake(input);
          await cfg.beforeWrite?.({ auth, tenantId, trx }, data, existing);
          await tenantScope(trx, cfg.table, tenantId).where({ id }).update(data);
          if (cfg.audited) await audit(trx, auth, `${cfg.table}.update`, cfg.table, id, data);
        }),
      );
      return service.get(auth, id);
    },
    async remove(auth: AuthContext, id: string) {
      const tenantId = requireTenantId(auth);
      await dbGuard(
        cfg.label.toLowerCase(),
        () =>
          withTransaction(async (trx) => {
            const existing = await repo.lock(tenantId, id, trx);
            if (!existing) throw new NotFoundError(cfg.label);
            cfg.beforeDelete?.(existing);
            await tenantScope(trx, cfg.table, tenantId).where({ id }).delete();
            if (cfg.audited) await audit(trx, auth, `${cfg.table}.delete`, cfg.table, id, null);
          }),
        true,
      );
    },
  };

  const sortKeys = Object.keys(cfg.sort) as [string, ...string[]];
  const listQuery = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(500).default(20),
    sort: z.enum(sortKeys).default(cfg.defaultSort),
    order: z.enum(['asc', 'desc']).default(cfg.defaultOrder ?? 'asc'),
    search: z.string().trim().min(1).max(100).optional(),
    ...Object.fromEntries(
      Object.entries(cfg.filters ?? {}).map(([k, f]) => [k, f.schema.optional()]),
    ),
  });

  type Req = FastifyRequest<{
    Params: { id: string };
    Querystring: Record<string, unknown>;
    Body: object;
  }>;
  // Handlers are typed against the parsed schemas; Fastify's generic inference can't see that.
  const h = (fn: (req: Req, reply: FastifyReply) => unknown) => fn as unknown as RouteHandlerMethod;
  function register(app: FastifyInstance, path: string) {
    const tags = [cfg.tag];
    const security = [{ bearerAuth: [] }];
    const read = requirePermissions(cfg.read);
    const manage = requirePermissions(cfg.manage);
    app.get(
      path,
      {
        preHandler: read,
        schema: { tags, security, summary: `List ${cfg.label}`, querystring: listQuery },
      },
      h(async (req: Req, reply: FastifyReply) => {
        const { items, meta } = await service.list(req.auth!, req.query);
        return sendSuccess(reply, items, { meta });
      }),
    );
    if (cfg.codePrefix)
      app.get(
        `${path}/next-code`,
        {
          preHandler: manage,
          schema: { tags, security, summary: `Suggest next ${cfg.label} code` },
        },
        h(async (req: Req, reply: FastifyReply) =>
          sendSuccess(reply, {
            code: await nextCode(db, cfg.table, requireTenantId(req.auth!), cfg.codePrefix!),
          }),
        ),
      );
    app.get(
      `${path}/:id`,
      {
        preHandler: read,
        schema: { tags, security, summary: `Get ${cfg.label}`, params: idParams },
      },
      h(async (req: Req, reply: FastifyReply) =>
        sendSuccess(reply, await service.get(req.auth!, req.params.id)),
      ),
    );
    app.post(
      path,
      {
        preHandler: manage,
        schema: { tags, security, summary: `Create ${cfg.label}`, body: cfg.create },
      },
      h(async (req: Req, reply: FastifyReply) =>
        sendSuccess(reply, await service.create(req.auth!, req.body as object), {
          statusCode: 201,
          message: `${cfg.label} created`,
        }),
      ),
    );
    app.patch(
      `${path}/:id`,
      {
        preHandler: manage,
        schema: {
          tags,
          security,
          summary: `Update ${cfg.label}`,
          params: idParams,
          body: cfg.patch,
        },
      },
      h(async (req: Req, reply: FastifyReply) =>
        sendSuccess(reply, await service.update(req.auth!, req.params.id, req.body as object), {
          message: `${cfg.label} updated`,
        }),
      ),
    );
    if (!cfg.noDelete)
      app.delete(
        `${path}/:id`,
        {
          preHandler: manage,
          schema: { tags, security, summary: `Delete ${cfg.label}`, params: idParams },
        },
        h(async (req: Req, reply: FastifyReply) => {
          await service.remove(req.auth!, req.params.id);
          return sendSuccess(reply, null, { message: `${cfg.label} deleted` });
        }),
      );
  }

  return { repo, service, register };
}

/* ── Shared Zod building blocks ─────────────────────────────── */

export const isoDate = z.iso.date();
export const code = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore')
  .transform((c) => c.toUpperCase());
export const name = (max = 150) => z.string().trim().min(1).max(max);
export const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullish();
export const money = z.coerce.number().min(0).max(1e12).multipleOf(0.01);
export const boolQuery = z.enum(['true', 'false']).transform((v) => v === 'true');
export const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #2563eb')
  .nullish();

/** PATCH body: every field optional, no defaults, at least one field. */
export function patchOf<T extends z.ZodObject>(s: T) {
  const shape = Object.fromEntries(
    Object.entries(s.shape).map(([k, v]) => [
      k,
      ((v as z.ZodType) instanceof z.ZodDefault ? (v as z.ZodDefault).unwrap() : v) as z.ZodType,
    ]),
  );
  return z
    .object(shape)
    .partial()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update');
}

export const employeeJoin =
  (column = 'x.employee_id', as = 'employee') =>
  (q: Knex.QueryBuilder) =>
    q
      .leftJoin(`employees as ${as}`, `${as}.id`, column)
      .select(
        db.raw(`${as}.first_name || ' ' || ${as}.last_name as ${as}_name`),
        `${as}.employee_number as ${as}_number`,
      );
