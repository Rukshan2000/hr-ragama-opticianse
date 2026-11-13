import { z } from 'zod';
import type { Knex } from 'knex';
import { db } from '../../database/knex';
import type { PaginationMeta } from './response';

/**
 * Builds a list-query schema. `sortable` is an allow-list mapping API field -> column,
 * so clients can never sort by arbitrary SQL.
 */
export function listQuerySchema<S extends string>(sortable: readonly [S, ...S[]], defaultSort: S) {
  return z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(sortable).default(defaultSort),
    order: z.enum(['asc', 'desc']).default('desc'),
    search: z.string().trim().min(1).max(100).optional(),
  });
}

export interface ListQuery<S extends string = string> {
  page: number;
  limit: number;
  sort: S;
  order: 'asc' | 'desc';
  search?: string;
}

/** Runs count + page in parallel against a filtered base query (no N+1, one round trip each). */
export async function paginate<T>(
  base: Knex.QueryBuilder,
  { page, limit }: Pick<ListQuery, 'page' | 'limit'>,
  orderBy: { column: string; order: 'asc' | 'desc' },
): Promise<{ items: T[]; meta: PaginationMeta }> {
  const [countRow, items] = await Promise.all([
    // Subquery count stays correct for grouped/joined base queries.
    db.count<{ count: string }[]>({ count: '*' }).from(base.clone().clearOrder().as('sub')).first(),
    base
      .clone()
      .orderBy(orderBy.column, orderBy.order)
      .limit(limit)
      .offset((page - 1) * limit) as Promise<T[]>,
  ]);
  const total = Number(countRow?.count ?? 0);
  return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

/** Escapes LIKE wildcards so user search text is matched literally. */
export function likeTerm(search: string): string {
  return `%${search.replace(/[\\%_]/g, '\\$&')}%`;
}
