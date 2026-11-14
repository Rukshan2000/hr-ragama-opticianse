import type { Knex } from 'knex';

/** Accounting integration: where each locked payroll run stands on the accounting side. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('payroll_runs', (t) => {
    t.string('accounting_status', 20).nullable(); // sent | failed | <accounting import status>
    t.string('accounting_message', 500).nullable();
    t.timestamp('accounting_synced_at', { useTz: true }).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('payroll_runs', (t) => {
    t.dropColumns('accounting_status', 'accounting_message', 'accounting_synced_at');
  });
}
