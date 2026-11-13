import type { Knex } from 'knex';
import { appConfig } from '../../config/app.config';
import { env } from '../../config/env';
import { createTenantWithDefaults } from '../../modules/tenants/tenants.service';
import { hashPassword } from '../../shared/utils/password';

/**
 * Development data only. Never runs in production.
 * Credentials can be overridden with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 */
export async function seed(knex: Knex): Promise<void> {
  if (env.NODE_ENV === 'production') return;

  const email = process.env.SEED_ADMIN_EMAIL ?? 'superadmin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  if (await knex('users').where({ email }).first('id')) return; // already seeded

  const passwordHash = await hashPassword(password);
  await knex.transaction(async (trx) => {
    const [superAdmin] = await trx('users')
      .insert({ name: 'Super Admin', email, password_hash: passwordHash })
      .returning<{ id: string }[]>('id');
    const platformRole = await trx('roles')
      .whereNull('tenant_id')
      .where({ slug: 'super-admin' })
      .first('id');
    await trx('user_roles').insert({ user_id: superAdmin!.id, role_id: platformRole.id });

    const [tenantAdmin] = await trx('users')
      .insert({ name: 'Demo Admin', email: 'admin@demo.example.com', password_hash: passwordHash })
      .returning<{ id: string }[]>('id');
    const { single, defaultName, defaultSlug } = appConfig.tenancy;
    await createTenantWithDefaults(trx, {
      name: single ? defaultName : 'Demo Company',
      slug: single ? defaultSlug : 'demo',
      ownerUserId: tenantAdmin!.id,
    });
  });
}
