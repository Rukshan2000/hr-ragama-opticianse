import type { Knex } from 'knex';
import { primaryUuid, softDelete, timestamps, updatedAtTrigger } from '../migration-helpers';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('tenants', (table) => {
    primaryUuid(knex, table);
    table.string('name', 150).notNullable();
    table.string('slug', 100).notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    timestamps(knex, table);
    softDelete(table);
  });
  await knex.raw(
    'CREATE UNIQUE INDEX tenants_slug_unique ON tenants (slug) WHERE deleted_at IS NULL',
  );
  await updatedAtTrigger(knex, 'tenants');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('tenants');
}
