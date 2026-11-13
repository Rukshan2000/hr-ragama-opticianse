import { db, type DbExecutor } from '../../database/knex';
import type { Permission } from '../../shared/constants/permissions';
import { likeTerm, paginate, type ListQuery } from '../../shared/utils/pagination';
import { tenantScope } from '../../shared/utils/tenant-scope';

export interface RoleRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_system: boolean;
  permissions: Permission[];
  created_at: Date;
  updated_at: Date;
}

const SORT_COLUMNS = { name: 'r.name', createdAt: 'r.created_at' } as const;
export type RoleSort = keyof typeof SORT_COLUMNS;

/** Roles with their permission keys aggregated in the same query. */
function rolesWithPermissions(executor: DbExecutor, tenantId: string) {
  return tenantScope(executor, 'roles as r', tenantId)
    .leftJoin('role_permissions as rp', 'rp.role_id', 'r.id')
    .leftJoin('permissions as p', 'p.id', 'rp.permission_id')
    .select(
      'r.id',
      'r.name',
      'r.slug',
      'r.description',
      'r.is_system',
      'r.created_at',
      'r.updated_at',
      executor.raw(
        `coalesce(array_agg(p.key ORDER BY p.key) FILTER (WHERE p.key IS NOT NULL), '{}') as permissions`,
      ),
    )
    .groupBy('r.id');
}

async function setPermissions(roleId: string, keys: readonly Permission[], executor: DbExecutor) {
  await executor('role_permissions').where({ role_id: roleId }).delete();
  if (keys.length === 0) return;
  await executor.raw(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT ?, id FROM permissions WHERE key = ANY(?::text[])`,
    [roleId, [...keys]],
  );
}

export const rolesRepository = {
  setPermissions,

  list(tenantId: string, query: ListQuery<RoleSort>) {
    const base = rolesWithPermissions(db, tenantId).modify((q) => {
      if (query.search) q.whereILike('r.name', likeTerm(query.search));
    });
    return paginate<RoleRow>(base, query, { column: SORT_COLUMNS[query.sort], order: query.order });
  },

  findById(tenantId: string, id: string, executor: DbExecutor = db): Promise<RoleRow | undefined> {
    return rolesWithPermissions(executor, tenantId).where('r.id', id).first();
  },

  async insert(
    tenantId: string,
    data: { name: string; slug: string; description?: string | null; is_system?: boolean },
    executor: DbExecutor,
  ): Promise<string> {
    const [row] = await executor('roles')
      .insert({ ...data, tenant_id: tenantId })
      .returning<{ id: string }[]>('id');
    return row!.id;
  },

  async update(
    tenantId: string,
    id: string,
    data: { name?: string; slug?: string; description?: string | null },
    executor: DbExecutor,
  ) {
    if (Object.keys(data).length === 0) return;
    await tenantScope(executor, 'roles', tenantId).where({ id }).update(data);
  },

  async delete(tenantId: string, id: string): Promise<void> {
    await tenantScope(db, 'roles', tenantId).where({ id }).delete();
  },

  /** Returns the subset of `ids` that are roles of this tenant (used to reject foreign role ids). */
  async filterTenantRoleIds(tenantId: string, ids: string[], executor: DbExecutor = db) {
    if (ids.length === 0) return [];
    const rows: { id: string }[] = await tenantScope(executor, 'roles', tenantId)
      .whereIn('id', ids)
      .select('id');
    return rows.map((r) => r.id);
  },

  async findIdBySlug(tenantId: string, slug: string, executor: DbExecutor = db) {
    const row = await tenantScope(executor, 'roles', tenantId).where({ slug }).first('id');
    return row?.id as string | undefined;
  },

  /** Creates the tenant's default roles; returns slug -> id. */
  async createDefaults(
    tenantId: string,
    templates: readonly { slug: string; name: string; permissions: readonly Permission[] }[],
    executor: DbExecutor,
  ): Promise<Record<string, string>> {
    const ids: Record<string, string> = {};
    for (const t of templates) {
      ids[t.slug] = await rolesRepository.insert(
        tenantId,
        { name: t.name, slug: t.slug, is_system: true },
        executor,
      );
      await setPermissions(ids[t.slug]!, t.permissions, executor);
    }
    return ids;
  },
};
