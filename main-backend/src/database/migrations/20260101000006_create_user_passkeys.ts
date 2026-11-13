import type { Knex } from 'knex';
import { primaryUuid, timestamps, updatedAtTrigger } from '../migration-helpers';

export async function up(knex: Knex): Promise<void> {
  // Public-key material only; private keys and biometrics never leave the authenticator.
  await knex.schema.createTable('user_passkeys', (table) => {
    primaryUuid(knex, table);
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.text('credential_id').notNullable().unique(); // base64url, as SimpleWebAuthn v13+ uses
    table.binary('public_key').notNullable(); // COSE-encoded
    table.bigInteger('counter').notNullable().defaultTo(0);
    table.jsonb('transports').notNullable().defaultTo('[]');
    table.string('device_type', 32).notNullable(); // singleDevice | multiDevice
    table.boolean('backed_up').notNullable().defaultTo(false);
    table.string('device_name', 100).nullable();
    timestamps(knex, table);
    table.timestamp('last_used_at', { useTz: true }).nullable();
    table.index(['user_id']);
  });
  await updatedAtTrigger(knex, 'user_passkeys');

  // Short-lived, single-use challenges. One row per ceremony, so concurrent attempts are isolated.
  await knex.schema.createTable('passkey_challenges', (table) => {
    primaryUuid(knex, table);
    table.string('purpose', 16).notNullable(); // registration | authentication
    table.text('challenge').notNullable();
    table.uuid('user_id').nullable().references('id').inTable('users').onDelete('CASCADE');
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.index(['expires_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('passkey_challenges');
  await knex.schema.dropTableIfExists('user_passkeys');
}
