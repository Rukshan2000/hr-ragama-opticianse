import { randomBytes } from 'node:crypto';
import type { Knex } from 'knex';
import { withTransaction } from '../../database/knex';
import { appConfig } from '../../config/app.config';
import {
  DEFAULT_TENANT_ROLES,
  TENANT_DEFAULT_ROLE,
  TENANT_OWNER_ROLE,
} from '../../shared/constants/permissions';
import { ConflictError, NotFoundError } from '../../shared/errors/app-error';
import { isUniqueViolation } from '../../shared/utils/db-errors';
import type { ListQuery } from '../../shared/utils/pagination';
import { hashPassword } from '../../shared/utils/password';
import { slugify } from '../../shared/utils/slug';
import { rolesRepository } from '../roles/roles.repository';
import { usersRepository } from '../users/users.repository';
import { tenantsRepository, type TenantRow, type TenantSort } from './tenants.repository';

export function toTenantDto(t: TenantRow) {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    isActive: t.is_active,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

async function uniqueSlug(name: string, trx: Knex.Transaction): Promise<string> {
  const base = slugify(name) || 'tenant';
  if (!(await tenantsRepository.slugExists(base, trx))) return base;
  return `${base}-${randomBytes(3).toString('hex')}`;
}

/**
 * Creates a tenant with its default roles inside the caller's transaction.
 * If `ownerUserId` is given, that user becomes an active member with the owner role.
 */
export async function createTenantWithDefaults(
  trx: Knex.Transaction,
  input: { name: string; slug?: string; ownerUserId?: string },
): Promise<TenantRow> {
  const slug = input.slug ?? (await uniqueSlug(input.name, trx));
  let tenant: TenantRow;
  try {
    tenant = await tenantsRepository.insert({ name: input.name, slug }, trx);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError('Tenant slug is already taken');
    throw err;
  }

  const roleIds = await rolesRepository.createDefaults(tenant.id, DEFAULT_TENANT_ROLES, trx);
  if (input.ownerUserId) {
    await usersRepository.addMembership(tenant.id, input.ownerUserId, trx);
    await usersRepository.replaceTenantRoles(
      tenant.id,
      input.ownerUserId,
      [roleIds[TENANT_OWNER_ROLE]!],
      trx,
    );
  }
  return tenant;
}

/**
 * Single-tenant mode: adds the user to the built-in tenant, creating it on first use.
 * The first member becomes its owner (admin); later ones get the default role.
 */
export async function joinDefaultTenant(trx: Knex.Transaction, userId: string): Promise<TenantRow> {
  const { defaultName, defaultSlug } = appConfig.tenancy;
  const existing = await tenantsRepository.findBySlug(defaultSlug, trx);
  if (!existing) {
    return createTenantWithDefaults(trx, {
      name: defaultName,
      slug: defaultSlug,
      ownerUserId: userId,
    });
  }
  const roleId = await rolesRepository.findIdBySlug(existing.id, TENANT_DEFAULT_ROLE, trx);
  await usersRepository.addMembership(existing.id, userId, trx);
  if (roleId) await usersRepository.replaceTenantRoles(existing.id, userId, [roleId], trx);
  return existing;
}

export const tenantsService = {
  async list(query: ListQuery<TenantSort> & { isActive?: boolean }) {
    const { items, meta } = await tenantsRepository.list(query);
    return { items: items.map(toTenantDto), meta };
  },

  async get(id: string) {
    const tenant = await tenantsRepository.findById(id);
    if (!tenant) throw new NotFoundError('Tenant');
    return toTenantDto(tenant);
  },

  async create(input: {
    name: string;
    slug?: string;
    owner?: { name: string; email: string; password: string };
  }) {
    const passwordHash = input.owner && (await hashPassword(input.owner.password));
    const tenant = await withTransaction(async (trx) => {
      const ownerUserId = input.owner
        ? await usersRepository.insertUser(
            { name: input.owner.name, email: input.owner.email, password_hash: passwordHash! },
            trx,
          )
        : undefined;
      return createTenantWithDefaults(trx, { name: input.name, slug: input.slug, ownerUserId });
    });
    return toTenantDto(tenant);
  },

  async update(id: string, input: { name?: string; isActive?: boolean }) {
    const tenant = await tenantsRepository.update(id, {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.isActive !== undefined && { is_active: input.isActive }),
    });
    if (!tenant) throw new NotFoundError('Tenant');
    return toTenantDto(tenant);
  },

  async remove(id: string) {
    if (!(await tenantsRepository.softDelete(id))) throw new NotFoundError('Tenant');
  },
};
