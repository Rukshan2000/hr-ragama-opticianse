import type { Knex } from 'knex';
import { tenantRef, tenantTable } from '../migration-helpers';

/**
 * Stage 5 payroll. Statutory rates (EPF/ETF/APIT) are never hard-coded: they live in
 * effective-dated payroll_policies. Finalized runs are immutable (enforced by trigger);
 * corrections are payroll_adjustments carried into a later period.
 */
export async function up(knex: Knex): Promise<void> {
  await tenantTable(knex, 'salary_components', (t) => {
    t.string('code', 20).notNullable();
    t.string('name', 100).notNullable();
    t.string('kind', 10).notNullable(); // earning | deduction
    t.boolean('is_taxable').notNullable().defaultTo(true);
    t.boolean('is_epf_applicable').notNullable().defaultTo(false);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.unique(['tenant_id', 'code']);
  });

  // Salary revisions: one row per change, effective-dated.
  await tenantTable(knex, 'employee_salaries', (t) => {
    tenantRef(t, 'employee_id', 'employees', 'CASCADE');
    t.date('effective_from').notNullable();
    t.decimal('basic_salary', 14, 2).notNullable();
    t.string('reason', 300).nullable();
    t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.unique(['tenant_id', 'employee_id', 'effective_from']);
  });
  // Recurring allowances/deductions attached to a salary revision.
  await tenantTable(
    knex,
    'employee_salary_items',
    (t) => {
      tenantRef(t, 'salary_id', 'employee_salaries', 'CASCADE');
      tenantRef(t, 'component_id', 'salary_components', 'RESTRICT');
      t.decimal('amount', 14, 2).notNullable();
      t.unique(['salary_id', 'component_id']);
    },
    { updatedAt: false },
  );

  await tenantTable(knex, 'payroll_policies', (t) => {
    t.date('effective_from').notNullable();
    t.decimal('epf_employee_rate', 5, 2).notNullable();
    t.decimal('epf_employer_rate', 5, 2).notNullable();
    t.decimal('etf_rate', 5, 2).notNullable();
    t.decimal('overtime_multiplier', 4, 2).notNullable().defaultTo(1.5);
    t.smallint('working_days_per_month').notNullable().defaultTo(30);
    t.decimal('working_hours_per_day', 4, 2).notNullable().defaultTo(8);
    // Monthly APIT brackets: [{ "upTo": 150000, "rate": 0 }, { "upTo": null, "rate": 36 }]
    t.jsonb('apit_brackets').notNullable();
    t.string('notes', 500).nullable();
    t.unique(['tenant_id', 'effective_from']);
  });

  await tenantTable(knex, 'employee_loans', (t) => {
    tenantRef(t, 'employee_id', 'employees', 'CASCADE');
    t.string('type', 10).notNullable(); // loan | advance
    t.decimal('principal', 14, 2).notNullable();
    t.decimal('installment', 14, 2).notNullable();
    t.decimal('balance', 14, 2).notNullable();
    t.date('start_date').notNullable();
    t.string('status', 10).notNullable().defaultTo('active');
    t.string('notes', 300).nullable();
  });

  await tenantTable(knex, 'payroll_runs', (t) => {
    t.smallint('year').notNullable();
    t.smallint('month').notNullable();
    t.string('status', 12).notNullable().defaultTo('draft');
    tenantRef(t, 'policy_id', 'payroll_policies', 'RESTRICT', true);
    t.decimal('total_gross', 16, 2).notNullable().defaultTo(0);
    t.decimal('total_net', 16, 2).notNullable().defaultTo(0);
    t.decimal('total_employer_cost', 16, 2).notNullable().defaultTo(0);
    t.smallint('employee_count').notNullable().defaultTo(0);
    t.timestamp('calculated_at', { useTz: true }).nullable();
    t.uuid('approved_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('approved_at', { useTz: true }).nullable();
    t.timestamp('locked_at', { useTz: true }).nullable();
    t.unique(['tenant_id', 'year', 'month']);
  });

  // One-off earnings/deductions (bonus, commission, correction) for a period.
  await tenantTable(knex, 'payroll_adjustments', (t) => {
    tenantRef(t, 'employee_id', 'employees', 'CASCADE');
    t.smallint('year').notNullable();
    t.smallint('month').notNullable();
    t.string('kind', 10).notNullable();
    t.string('label', 100).notNullable();
    t.decimal('amount', 14, 2).notNullable();
    t.boolean('is_taxable').notNullable().defaultTo(true);
    t.boolean('is_epf_applicable').notNullable().defaultTo(false);
    t.string('reason', 300).nullable();
    t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.index(['tenant_id', 'year', 'month']);
  });

  await tenantTable(knex, 'payslips', (t) => {
    tenantRef(t, 'run_id', 'payroll_runs', 'CASCADE');
    tenantRef(t, 'employee_id', 'employees', 'RESTRICT');
    t.decimal('basic_salary', 14, 2).notNullable();
    t.jsonb('earnings').notNullable(); // [{label, amount}]
    t.jsonb('deductions').notNullable();
    t.decimal('overtime_hours', 8, 2).notNullable().defaultTo(0);
    t.decimal('overtime_pay', 14, 2).notNullable().defaultTo(0);
    t.decimal('unpaid_days', 5, 1).notNullable().defaultTo(0);
    t.decimal('unpaid_leave_deduction', 14, 2).notNullable().defaultTo(0);
    t.decimal('gross_pay', 14, 2).notNullable();
    t.decimal('epf_employee', 14, 2).notNullable();
    t.decimal('epf_employer', 14, 2).notNullable();
    t.decimal('etf', 14, 2).notNullable();
    t.decimal('apit', 14, 2).notNullable();
    t.decimal('loan_deduction', 14, 2).notNullable().defaultTo(0);
    t.decimal('total_deductions', 14, 2).notNullable();
    t.decimal('net_pay', 14, 2).notNullable();
    t.unique(['run_id', 'employee_id']);
  });

  await knex.raw(`
    ALTER TABLE salary_components ADD CONSTRAINT salary_components_kind CHECK (kind IN ('earning','deduction'));
    ALTER TABLE employee_salaries ADD CONSTRAINT employee_salaries_basic CHECK (basic_salary >= 0);
    ALTER TABLE employee_salary_items ADD CONSTRAINT salary_items_amount CHECK (amount >= 0);
    ALTER TABLE payroll_policies ADD CONSTRAINT payroll_policies_rates CHECK (
      epf_employee_rate BETWEEN 0 AND 100 AND epf_employer_rate BETWEEN 0 AND 100 AND etf_rate BETWEEN 0 AND 100
      AND overtime_multiplier >= 0 AND working_days_per_month BETWEEN 1 AND 31);
    ALTER TABLE employee_loans
      ADD CONSTRAINT employee_loans_type CHECK (type IN ('loan','advance')),
      ADD CONSTRAINT employee_loans_status CHECK (status IN ('active','settled','cancelled')),
      ADD CONSTRAINT employee_loans_amounts CHECK (principal > 0 AND installment > 0 AND balance >= 0);
    ALTER TABLE payroll_runs
      ADD CONSTRAINT payroll_runs_status CHECK (status IN ('draft','calculated','approved','locked')),
      ADD CONSTRAINT payroll_runs_month CHECK (month BETWEEN 1 AND 12);
    ALTER TABLE payroll_adjustments
      ADD CONSTRAINT payroll_adjustments_kind CHECK (kind IN ('earning','deduction')),
      ADD CONSTRAINT payroll_adjustments_amount CHECK (amount > 0),
      ADD CONSTRAINT payroll_adjustments_month CHECK (month BETWEEN 1 AND 12);

    -- Defence in depth: payslips of an approved/locked run can never be written again.
    -- (DELETE is left to tenant-deletion cascades; the service never deletes finalized payslips.)
    CREATE OR REPLACE FUNCTION payslips_immutable() RETURNS trigger AS $$
    DECLARE s text;
    BEGIN
      SELECT status INTO s FROM payroll_runs WHERE id = NEW.run_id;
      IF s IN ('approved','locked') THEN
        RAISE EXCEPTION 'payroll run is finalized' USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_payslips_immutable BEFORE INSERT OR UPDATE ON payslips
      FOR EACH ROW EXECUTE FUNCTION payslips_immutable();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS trg_payslips_immutable ON payslips');
  await knex.raw('DROP FUNCTION IF EXISTS payslips_immutable()');
  for (const t of [
    'payslips',
    'payroll_adjustments',
    'payroll_runs',
    'employee_loans',
    'payroll_policies',
    'employee_salary_items',
    'employee_salaries',
    'salary_components',
  ])
    await knex.schema.dropTableIfExists(t);
}
