import { db, type DbExecutor } from '../../database/knex';
import { ConflictError } from '../../shared/errors/app-error';
import { isUniqueViolation } from '../../shared/utils/db-errors';
import { likeTerm, paginate, type ListQuery } from '../../shared/utils/pagination';
import { tenantScope } from '../../shared/utils/tenant-scope';

export interface TenantUserRow {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
  last_login_at: Date | null;
  joined_at: Date;
}

export interface RoleSummary {
  id: string;
  name: string;
  slug: string;
}

const SORT_COLUMNS = { name: 'u.name', email: 'u.email', createdAt: 'm.created_at' } as const;
export type UserSort = keyof typeof SORT_COLUMNS;

/** Users visible to a tenant are exactly its members. Password hashes are never selected here. */
function tenantUsers(executor: DbExecutor, tenantId: string) {
  return tenantScope(executor, 'tenant_memberships as m', tenantId)
    .join('users as u', 'u.id', 'm.user_id')
    .whereNull('u.deleted_at')
    .select(
      'u.id',
      'u.name',
      'u.email',
      executor.raw('(m.is_active AND u.is_active) as is_active'),
      'u.last_login_at',
      'm.created_at as joined_at',
    );
}

export const usersRepository = {
  list(tenantId: string, query: ListQuery<UserSort> & { isActive?: boolean }) {
    const base = tenantUsers(db, tenantId).modify((q) => {
      if (query.isActive !== undefined) q.where('m.is_active', query.isActive);
      if (query.search) {
        const term = likeTerm(query.search);
        q.where((w) => w.whereILike('u.name', term).orWhereILike('u.email', term));
      }
    });
    return paginate<TenantUserRow>(base, query, {
      column: SORT_COLUMNS[query.sort],
      order: query.order,
    });
  },

  findInTenant(tenantId: string, userId: string, executor: DbExecutor = db) {
    return tenantUsers(executor, tenantId).where('u.id', userId).first() as Promise<
      TenantUserRow | undefined
    >;
  },

  /** Batched role lookup for many users: one query regardless of page size. */
  async rolesForUsers(tenantId: string, userIds: string[]): Promise<Map<string, RoleSummary[]>> {
    const map = new Map<string, RoleSummary[]>(userIds.map((id) => [id, []]));
    if (userIds.length === 0) return map;
    const rows: (RoleSummary & { user_id: string })[] = await db('user_roles as ur')
      .join('roles as r', 'r.id', 'ur.role_id')
      .where('r.tenant_id', tenantId)
      .whereIn('ur.user_id', userIds)
      .select('ur.user_id', 'r.id', 'r.name', 'r.slug')
      .orderBy('r.name');
    for (const { user_id, ...role } of rows) map.get(user_id)?.push(role);
    return map;
  },

  async insertUser(
    data: { name: string; email: string; password_hash: string },
    executor: DbExecutor,
  ): Promise<string> {
    try {
      const [row] = await executor('users').insert(data).returning<{ id: string }[]>('id');
      return row!.id;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('Email is already registered');
      throw err;
    }
  },

  async updateName(userId: string, name: string, executor: DbExecutor = db) {
    await executor('users').where({ id: userId }).update({ name });
  },

  async addMembership(tenantId: string, userId: string, executor: DbExecutor) {
    await executor('tenant_memberships').insert({ tenant_id: tenantId, user_id: userId });
  },

  async setMembershipActive(tenantId: string, userId: string, isActive: boolean) {
    await tenantScope(db, 'tenant_memberships', tenantId)
      .where({ user_id: userId })
      .update({ is_active: isActive });
  },

  /** Replaces only this tenant's roles for the user; roles in other tenants are untouched. */
  async replaceTenantRoles(
    tenantId: string,
    userId: string,
    roleIds: string[],
    executor: DbExecutor,
  ) {
    await executor('user_roles')
      .where({ user_id: userId })
      .whereIn('role_id', tenantScope(executor, 'roles', tenantId).select('id'))
      .delete();
    if (roleIds.length > 0) {
      await executor('user_roles').insert(roleIds.map((role_id) => ({ user_id: userId, role_id })));
    }
  },

  async removeMembership(tenantId: string, userId: string, executor: DbExecutor) {
    await usersRepository.replaceTenantRoles(tenantId, userId, [], executor);
    await tenantScope(executor, 'tenant_memberships', tenantId).where({ user_id: userId }).delete();
  },

  /** True if the user still belongs to any tenant or holds a platform role. */
  async hasAnyAccess(userId: string, executor: DbExecutor): Promise<boolean> {
    const row = await executor
      .select(
        executor.raw(
          `exists(select 1 from tenant_memberships where user_id = ?)
           or exists(select 1 from user_roles ur join roles r on r.id = ur.role_id
                     where ur.user_id = ? and r.tenant_id is null) as has_access`,
          [userId, userId],
        ),
      )
      .first();
    return Boolean(row?.has_access);
  },

  async softDelete(userId: string, executor: DbExecutor) {
    await executor('users')
      .where({ id: userId })
      .update({ deleted_at: executor.fn.now(), is_active: false });
  },
};
