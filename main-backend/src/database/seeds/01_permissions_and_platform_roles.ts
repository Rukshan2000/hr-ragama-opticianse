import type { Knex } from 'knex';
import {
  DEFAULT_TENANT_ROLES,
  PERMISSION_DESCRIPTIONS,
  PLATFORM_ROLES,
  TENANT_OWNER_ROLE,
  type Permission,
} from '../../shared/constants/permissions';
import { rolesRepository } from '../../modules/roles/roles.repository';

/**
 * Reference data, safe in every environment and idempotent: syncs the permission catalog
 * from code and (re)applies platform role permissions.
 */
export async function seed(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    const rows = (Object.entries(PERMISSION_DESCRIPTIONS) as [Permission, string][]).map(
      ([key, description]) => ({ key, description }),
    );
    await trx('permissions').insert(rows).onConflict('key').merge(['description']);

    for (const role of PLATFORM_ROLES) {
      const [row] = await trx('roles')
        .insert({ tenant_id: null, slug: role.slug, name: role.name, is_system: true })
        .onConflict(knex.raw('(tenant_id, slug)'))
        .merge(['name'])
        .returning<{ id: string }[]>('id');
      await rolesRepository.setPermissions(row!.id, role.permissions, trx);
    }

    // Back-fill default roles added after a tenant was created. Existing roles keep their
    // (possibly customised) permissions; only the owner role gains newly added permissions.
    const tenants: { id: string }[] = await trx('tenants').select('id');
    for (const { id: tenantId } of tenants) {
      for (const t of DEFAULT_TENANT_ROLES) {
        const [created] = await trx('roles')
          .insert({ tenant_id: tenantId, slug: t.slug, name: t.name, is_system: true })
          .onConflict(knex.raw('(tenant_id, slug)'))
          .ignore()
          .returning<{ id: string }[]>('id');
        if (created) await rolesRepository.setPermissions(created.id, t.permissions, trx);
      }
      const owner = DEFAULT_TENANT_ROLES.find((r) => r.slug === TENANT_OWNER_ROLE)!;
      await trx.raw(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key = ANY(?::text[])
         WHERE r.tenant_id = ? AND r.slug = ?
         ON CONFLICT DO NOTHING`,
        [[...owner.permissions], tenantId, TENANT_OWNER_ROLE],
      );
    }
  });
}
