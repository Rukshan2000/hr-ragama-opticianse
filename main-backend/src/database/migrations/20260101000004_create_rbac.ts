import type { Knex } from 'knex';
import { primaryUuid, timestamps, updatedAtTrigger } from '../migration-helpers';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('permissions', (table) => {
    primaryUuid(knex, table);
    table.string('key', 100).notNullable().unique();
    table.string('description', 255).notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // tenant_id NULL = platform role (e.g. Super Admin); otherwise the role belongs to that tenant.
  await knex.schema.createTable('roles', (table) => {
    primaryUuid(knex, table);
    table.uuid('tenant_id').nullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.string('name', 100).notNullable();
    table.string('slug', 100).notNullable();
    table.string('description', 255).nullable();
    table.boolean('is_system').notNullable().defaultTo(false);
    timestamps(knex, table);
  });
  await knex.raw(
    'CREATE UNIQUE INDEX roles_tenant_slug_unique ON roles (tenant_id, slug) NULLS NOT DISTINCT',
  );
  await updatedAtTrigger(knex, 'roles');

  await knex.schema.createTable('role_permissions', (table) => {
    table.uuid('role_id').notNullable().references('id').inTable('roles').onDelete('CASCADE');
    table
      .uuid('permission_id')
      .notNullable()
      .references('id')
      .inTable('permissions')
      .onDelete('CASCADE');
    table.primary(['role_id', 'permission_id']);
    table.index(['permission_id']);
  });

  await knex.schema.createTable('tenant_memberships', (table) => {
    primaryUuid(knex, table);
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.boolean('is_active').notNullable().defaultTo(true);
    timestamps(knex, table);
    table.unique(['tenant_id', 'user_id']);
    table.index(['user_id']);
  });
  await updatedAtTrigger(knex, 'tenant_memberships');

  await knex.schema.createTable('user_roles', (table) => {
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.uuid('role_id').notNullable().references('id').inTable('roles').onDelete('CASCADE');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['user_id', 'role_id']);
    table.index(['role_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_roles');
  await knex.schema.dropTableIfExists('tenant_memberships');
  await knex.schema.dropTableIfExists('role_permissions');
  await knex.schema.dropTableIfExists('roles');
  await knex.schema.dropTableIfExists('permissions');
}
