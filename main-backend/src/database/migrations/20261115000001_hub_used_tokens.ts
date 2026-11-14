import type { Knex } from 'knex';

/** InvoHub launch-token ids already redeemed, so a token works once. Rows expire with the token. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('hub_used_tokens', (t) => {
    t.string('jti', 100).primary();
    t.timestamp('expires_at', { useTz: true }).notNullable().index();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('hub_used_tokens');
}
