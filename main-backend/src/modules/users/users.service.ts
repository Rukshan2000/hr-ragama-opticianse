import { withTransaction } from '../../database/knex';
import { PERMISSIONS, TENANT_DEFAULT_ROLE } from '../../shared/constants/permissions';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors/app-error';
import type { AuthContext } from '../../shared/types/auth';
import { hashPassword } from '../../shared/utils/password';
import { requireTenantId } from '../../shared/utils/tenant-scope';
import { authRepository } from '../auth/auth.repository';
import { rolesRepository } from '../roles/roles.repository';
import { usersRepository, type RoleSummary, type TenantUserRow } from './users.repository';
import type { CreateUserBody, ListUsersQuery, UpdateUserBody } from './users.schema';

function toUserDto(u: TenantUserRow, roles: RoleSummary[]) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    isActive: u.is_active,
    lastLoginAt: u.last_login_at,
    joinedAt: u.joined_at,
    roles,
  };
}

/** Assigning roles is privilege-granting, so it needs roles:manage on top of users:*. */
async function resolveRoleIds(auth: AuthContext, tenantId: string, roleIds: string[]) {
  if (!auth.permissions.has(PERMISSIONS.ROLES_MANAGE)) {
    throw new ForbiddenError('Assigning roles requires the roles:manage permission');
  }
  const unique = [...new Set(roleIds)];
  const valid = await rolesRepository.filterTenantRoleIds(tenantId, unique);
  if (valid.length !== unique.length) {
    throw new BadRequestError('One or more roles do not exist in this tenant', [
      { field: 'roleIds', message: 'Unknown role id' },
    ]);
  }
  return unique;
}

export const usersService = {
  async list(auth: AuthContext, query: ListUsersQuery) {
    const tenantId = requireTenantId(auth);
    const { items, meta } = await usersRepository.list(tenantId, query);
    const roles = await usersRepository.rolesForUsers(
      tenantId,
      items.map((u) => u.id),
    );
    return { items: items.map((u) => toUserDto(u, roles.get(u.id) ?? [])), meta };
  },

  async get(auth: AuthContext, userId: string) {
    const tenantId = requireTenantId(auth);
    const user = await usersRepository.findInTenant(tenantId, userId);
    if (!user) throw new NotFoundError('User');
    const roles = await usersRepository.rolesForUsers(tenantId, [userId]);
    return toUserDto(user, roles.get(userId) ?? []);
  },

  async create(auth: AuthContext, input: CreateUserBody) {
    const tenantId = requireTenantId(auth);
    const roleIds = input.roleIds?.length
      ? await resolveRoleIds(auth, tenantId, input.roleIds)
      : [await rolesRepository.findIdBySlug(tenantId, TENANT_DEFAULT_ROLE)].filter(
          (id): id is string => Boolean(id),
        );
    const passwordHash = await hashPassword(input.password);

    const userId = await withTransaction(async (trx) => {
      const id = await usersRepository.insertUser(
        { name: input.name, email: input.email, password_hash: passwordHash },
        trx,
      );
      await usersRepository.addMembership(tenantId, id, trx);
      await usersRepository.replaceTenantRoles(tenantId, id, roleIds, trx);
      return id;
    });
    return usersService.get(auth, userId);
  },

  async update(auth: AuthContext, userId: string, input: UpdateUserBody) {
    const tenantId = requireTenantId(auth);
    if (!(await usersRepository.findInTenant(tenantId, userId))) throw new NotFoundError('User');
    const roleIds = input.roleIds && (await resolveRoleIds(auth, tenantId, input.roleIds));
    if (roleIds && userId === auth.userId) {
      throw new ForbiddenError('You cannot change your own roles');
    }

    await withTransaction(async (trx) => {
      if (input.name) await usersRepository.updateName(userId, input.name, trx);
      if (roleIds) await usersRepository.replaceTenantRoles(tenantId, userId, roleIds, trx);
    });
    return usersService.get(auth, userId);
  },

  /** Per tenant membership. Takes effect at once: every request and refresh re-checks membership. */
  async setStatus(auth: AuthContext, userId: string, isActive: boolean) {
    const tenantId = requireTenantId(auth);
    if (userId === auth.userId) throw new ForbiddenError('You cannot change your own status');
    if (!(await usersRepository.findInTenant(tenantId, userId))) throw new NotFoundError('User');
    await usersRepository.setMembershipActive(tenantId, userId, isActive);
    return usersService.get(auth, userId);
  },

  /** Removes the user from this tenant; the account is soft-deleted once it has no access left. */
  async remove(auth: AuthContext, userId: string) {
    const tenantId = requireTenantId(auth);
    if (userId === auth.userId) throw new ForbiddenError('You cannot remove yourself');
    if (!(await usersRepository.findInTenant(tenantId, userId))) throw new NotFoundError('User');
    await withTransaction(async (trx) => {
      await usersRepository.removeMembership(tenantId, userId, trx);
      if (!(await usersRepository.hasAnyAccess(userId, trx))) {
        await usersRepository.softDelete(userId, trx);
        await authRepository.revokeAllForUser(userId, trx);
      }
    });
  },
};
