import type { Knex } from 'knex';

/**
 * InvoHub master data: hub id -> local row. A tenant row marks the tenant as hub-managed
 * (users, roles and organization are then edited in InvoHub only).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('hub_links', (t) => {
    t.string('entity', 30).notNullable();
    t.uuid('hub_id').notNullable();
    t.uuid('local_id').notNullable();
    t.uuid('tenant_id').notNullable();
    t.primary(['entity', 'hub_id', 'tenant_id']);
    t.index(['tenant_id', 'entity']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('hub_links');
}
