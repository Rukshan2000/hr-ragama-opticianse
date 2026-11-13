import type { Knex } from 'knex';
import { primaryUuid, timestamps, updatedAtTrigger } from '../migration-helpers';

/**
 * Organization structure. Master data (branches, departments, designations) is deactivated
 * rather than soft-deleted; hard deletes are blocked by FK RESTRICT while anything references it.
 * Org units form the chart (parent/level); employees are NOT attached to chart nodes.
 */
export async function up(knex: Knex): Promise<void> {
  const tenantFk = (t: Knex.CreateTableBuilder) =>
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');

  await knex.schema.createTable('branches', (t) => {
    primaryUuid(knex, t);
    tenantFk(t);
    t.string('code', 30).notNullable();
    t.string('name', 150).notNullable();
    t.string('address', 500).nullable();
    t.string('phone', 30).nullable();
    t.string('email', 255).nullable();
    t.string('timezone', 64).notNullable().defaultTo('Asia/Colombo');
    t.boolean('is_active').notNullable().defaultTo(true);
    timestamps(knex, t);
    t.unique(['tenant_id', 'code']);
    t.unique(['tenant_id', 'id']); // target for composite tenant-safe FKs
  });

  await knex.schema.createTable('departments', (t) => {
    primaryUuid(knex, t);
    tenantFk(t);
    t.string('code', 30).notNullable();
    t.string('name', 150).notNullable();
    t.string('description', 500).nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    timestamps(knex, t);
    t.unique(['tenant_id', 'code']);
    t.unique(['tenant_id', 'id']);
  });

  await knex.schema.createTable('designations', (t) => {
    primaryUuid(knex, t);
    tenantFk(t);
    t.string('code', 30).notNullable();
    t.string('name', 150).notNullable(); // job title
    t.string('description', 500).nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    timestamps(knex, t);
    t.unique(['tenant_id', 'code']);
    t.unique(['tenant_id', 'id']);
  });

  // rank: 1 = top of the hierarchy (e.g. Company), larger = deeper (Division, Unit, Team…).
  await knex.schema.createTable('org_levels', (t) => {
    primaryUuid(knex, t);
    tenantFk(t);
    t.string('name', 100).notNullable();
    t.integer('rank').notNullable();
    t.string('description', 500).nullable();
    timestamps(knex, t);
    t.unique(['tenant_id', 'name']);
    t.unique(['tenant_id', 'rank']);
    t.unique(['tenant_id', 'id']);
    t.check('?? > 0', ['rank'], 'org_levels_rank_positive');
  });

  await knex.schema.createTable('org_units', (t) => {
    primaryUuid(knex, t);
    tenantFk(t);
    t.string('name', 150).notNullable();
    t.string('code', 30).nullable();
    t.uuid('parent_id').nullable();
    t.uuid('level_id').notNullable();
    t.uuid('department_id').nullable(); // optional link to the HR department it represents
    t.string('description', 500).nullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    timestamps(knex, t);
    t.unique(['tenant_id', 'id']);
    t.index(['tenant_id', 'parent_id']);
    // Composite FKs make cross-tenant references impossible at the database level.
    t.foreign(['tenant_id', 'parent_id'])
      .references(['tenant_id', 'id'])
      .inTable('org_units')
      .onDelete('RESTRICT');
    t.foreign(['tenant_id', 'level_id'])
      .references(['tenant_id', 'id'])
      .inTable('org_levels')
      .onDelete('RESTRICT');
    t.foreign(['tenant_id', 'department_id'])
      .references(['tenant_id', 'id'])
      .inTable('departments')
      .onDelete('RESTRICT');
    t.check('?? IS DISTINCT FROM ??', ['parent_id', 'id'], 'org_units_not_own_parent');
  });
  await knex.raw(
    `CREATE UNIQUE INDEX org_units_tenant_code_unique ON org_units (tenant_id, code) WHERE code IS NOT NULL`,
  );

  for (const table of ['branches', 'departments', 'designations', 'org_levels', 'org_units']) {
    await updatedAtTrigger(knex, table);
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const table of ['org_units', 'org_levels', 'designations', 'departments', 'branches']) {
    await knex.schema.dropTableIfExists(table);
  }
}
