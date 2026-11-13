import { withTransaction } from '../../database/knex';
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/app-error';
import type { AuthContext } from '../../shared/types/auth';
import { isUniqueViolation } from '../../shared/utils/db-errors';
import { slugify } from '../../shared/utils/slug';
import { requireTenantId } from '../../shared/utils/tenant-scope';
import { rolesRepository, type RoleRow } from './roles.repository';
import type { CreateRoleBody, ListRolesQuery, UpdateRoleBody } from './roles.schema';

function toRoleDto(r: RoleRow) {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    isSystem: r.is_system,
    permissions: r.permissions,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function uniqueRole<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError('A role with this name already exists');
    throw err;
  }
}

export const rolesService = {
  async list(auth: AuthContext, query: ListRolesQuery) {
    const { items, meta } = await rolesRepository.list(requireTenantId(auth), query);
    return { items: items.map(toRoleDto), meta };
  },

  async get(auth: AuthContext, id: string) {
    const role = await rolesRepository.findById(requireTenantId(auth), id);
    if (!role) throw new NotFoundError('Role');
    return toRoleDto(role);
  },

  async create(auth: AuthContext, input: CreateRoleBody) {
    const tenantId = requireTenantId(auth);
    const id = await uniqueRole(() =>
      withTransaction(async (trx) => {
        const roleId = await rolesRepository.insert(
          tenantId,
          { name: input.name, slug: slugify(input.name), description: input.description ?? null },
          trx,
        );
        await rolesRepository.setPermissions(roleId, input.permissions, trx);
        return roleId;
      }),
    );
    return rolesService.get(auth, id);
  },

  async update(auth: AuthContext, id: string, input: UpdateRoleBody) {
    const tenantId = requireTenantId(auth);
    if (!(await rolesRepository.findById(tenantId, id))) throw new NotFoundError('Role');
    await uniqueRole(() =>
      withTransaction(async (trx) => {
        await rolesRepository.update(
          tenantId,
          id,
          {
            ...(input.name !== undefined && { name: input.name, slug: slugify(input.name) }),
            ...(input.description !== undefined && { description: input.description }),
          },
          trx,
        );
        if (input.permissions) await rolesRepository.setPermissions(id, input.permissions, trx);
      }),
    );
    return rolesService.get(auth, id);
  },

  async remove(auth: AuthContext, id: string) {
    const tenantId = requireTenantId(auth);
    const role = await rolesRepository.findById(tenantId, id);
    if (!role) throw new NotFoundError('Role');
    if (role.is_system) throw new ForbiddenError('System roles cannot be deleted');
    await rolesRepository.delete(tenantId, id);
  },
};
