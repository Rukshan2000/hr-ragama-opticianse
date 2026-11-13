import { db, type DbExecutor } from '../../database/knex';
import { likeTerm, paginate, type ListQuery } from '../../shared/utils/pagination';

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = ['id', 'name', 'slug', 'is_active', 'created_at', 'updated_at'];
const SORT_COLUMNS = { name: 'name', slug: 'slug', createdAt: 'created_at' } as const;
export type TenantSort = keyof typeof SORT_COLUMNS;

export const tenantsRepository = {
  list(query: ListQuery<TenantSort> & { isActive?: boolean }) {
    const base = db('tenants')
      .select(COLUMNS)
      .whereNull('deleted_at')
      .modify((q) => {
        if (query.isActive !== undefined) q.where('is_active', query.isActive);
        if (query.search) {
          const term = likeTerm(query.search);
          q.where((w) => w.whereILike('name', term).orWhereILike('slug', term));
        }
      });
    return paginate<TenantRow>(base, query, {
      column: SORT_COLUMNS[query.sort],
      order: query.order,
    });
  },

  findById(id: string, executor: DbExecutor = db): Promise<TenantRow | undefined> {
    return executor('tenants').select(COLUMNS).where({ id }).whereNull('deleted_at').first();
  },

  findBySlug(slug: string, executor: DbExecutor = db): Promise<TenantRow | undefined> {
    return executor('tenants').select(COLUMNS).where({ slug }).whereNull('deleted_at').first();
  },

  async slugExists(slug: string, executor: DbExecutor = db): Promise<boolean> {
    return Boolean(await executor('tenants').where({ slug }).whereNull('deleted_at').first('id'));
  },

  async insert(data: { name: string; slug: string }, executor: DbExecutor): Promise<TenantRow> {
    const [row] = await executor('tenants').insert(data).returning<TenantRow[]>(COLUMNS);
    return row!;
  },

  async update(id: string, data: Partial<Pick<TenantRow, 'name' | 'is_active'>>) {
    const [row] = await db('tenants')
      .where({ id })
      .whereNull('deleted_at')
      .update(data)
      .returning<TenantRow[]>(COLUMNS);
    return row;
  },

  async softDelete(id: string): Promise<boolean> {
    const count = await db('tenants')
      .where({ id })
      .whereNull('deleted_at')
      .update({ deleted_at: db.fn.now(), is_active: false });
    return count > 0;
  },
};
