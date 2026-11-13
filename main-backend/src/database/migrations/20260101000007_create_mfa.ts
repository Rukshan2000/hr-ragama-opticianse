import type { Knex } from 'knex';
import { primaryUuid } from '../migration-helpers';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.text('mfa_totp_secret').nullable(); // AES-256-GCM encrypted, see shared/utils/crypto.ts
    table.timestamp('mfa_totp_enabled_at', { useTz: true }).nullable();
    table.bigInteger('mfa_totp_last_step').nullable(); // blocks reuse of an accepted code
    table.timestamp('mfa_email_enabled_at', { useTz: true }).nullable();
    table.timestamp('mfa_passkey_enabled_at', { useTz: true }).nullable();
  });

  await knex.schema.createTable('mfa_recovery_codes', (table) => {
    primaryUuid(knex, table);
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('code_hash', 64).notNullable();
    table.timestamp('used_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['user_id', 'code_hash']);
  });

  // A password-verified login waiting for its second factor.
  await knex.schema.createTable('mfa_challenges', (table) => {
    primaryUuid(knex, table);
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('token_hash', 64).notNullable().unique();
    table.string('tenant_slug', 100).nullable();
    table.integer('attempts').notNullable().defaultTo(0);
    table.string('email_code_hash', 64).nullable();
    table.timestamp('email_sent_at', { useTz: true }).nullable();
    table.text('passkey_challenge').nullable();
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.index(['expires_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('mfa_challenges');
  await knex.schema.dropTableIfExists('mfa_recovery_codes');
  await knex.schema.alterTable('users', (table) => {
    table.dropColumns(
      'mfa_totp_secret',
      'mfa_totp_enabled_at',
      'mfa_totp_last_step',
      'mfa_email_enabled_at',
      'mfa_passkey_enabled_at',
    );
  });
}
