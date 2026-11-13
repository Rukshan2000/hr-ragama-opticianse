import type { Knex } from 'knex';
import { primaryUuid, softDelete, timestamps, updatedAtTrigger } from '../migration-helpers';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (table) => {
    primaryUuid(knex, table);
    table.string('name', 150).notNullable();
    table.specificType('email', 'citext').notNullable();
    table.string('password_hash', 255).notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.integer('failed_login_attempts').notNullable().defaultTo(0);
    table.timestamp('locked_until', { useTz: true }).nullable();
    table.timestamp('last_login_at', { useTz: true }).nullable();
    table.timestamp('password_changed_at', { useTz: true }).nullable();
    timestamps(knex, table);
    softDelete(table);
  });
  await knex.raw(
    'CREATE UNIQUE INDEX users_email_unique ON users (email) WHERE deleted_at IS NULL',
  );
  await updatedAtTrigger(knex, 'users');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('users');
}
