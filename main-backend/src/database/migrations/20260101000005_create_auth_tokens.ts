import type { Knex } from 'knex';
import { primaryUuid } from '../migration-helpers';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('refresh_tokens', (table) => {
    primaryUuid(knex, table);
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.uuid('tenant_id').nullable().references('id').inTable('tenants').onDelete('CASCADE');
    // All tokens issued from one login share a family; reuse of a rotated token revokes the family.
    table.uuid('family_id').notNullable();
    table.string('token_hash', 64).notNullable().unique();
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('revoked_at', { useTz: true }).nullable();
    table.uuid('replaced_by_id').nullable();
    table.string('ip', 64).nullable();
    table.string('user_agent', 255).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['user_id']);
    table.index(['family_id']);
  });

  await knex.schema.createTable('password_reset_tokens', (table) => {
    primaryUuid(knex, table);
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('token_hash', 64).notNullable().unique();
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('used_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['user_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('password_reset_tokens');
  await knex.schema.dropTableIfExists('refresh_tokens');
}
