import type { Knex } from 'knex';
import { primaryUuid, softDelete, timestamps, updatedAtTrigger } from '../migration-helpers';

export const EMPLOYEE_STATUSES = [
  'onboarding',
  'probation',
  'active',
  'on_notice',
  'inactive',
  'resigned',
  'terminated',
] as const;
export const EMPLOYMENT_TYPES = ['permanent', 'temporary', 'contract', 'internship'] as const;
export const GENDERS = ['male', 'female', 'other', 'undisclosed'] as const;
export const HISTORY_FIELDS = [
  'joined',
  'department',
  'designation',
  'branch',
  'manager',
  'status',
  'employment_type',
] as const;

const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(',');

/**
 * Employee records are independent of login accounts: user_id is optional and an employee
 * can exist without one. Department/designation/branch/manager live here, never on chart nodes.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('employees', (t) => {
    primaryUuid(knex, t);
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.uuid('user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('employee_number', 30).notNullable();
    t.string('first_name', 100).notNullable();
    t.string('last_name', 100).notNullable();
    t.string('display_name', 150).nullable();
    t.string('email', 255).nullable();
    t.string('phone', 30).nullable();
    t.date('date_of_birth').nullable();
    t.string('gender', 20).nullable();
    t.string('address', 500).nullable();
    t.string('emergency_contact_name', 150).nullable();
    t.string('emergency_contact_phone', 30).nullable();
    t.string('emergency_contact_relationship', 50).nullable();
    t.string('status', 20).notNullable().defaultTo('onboarding');
    t.string('employment_type', 20).notNullable().defaultTo('permanent');
    t.date('joining_date').notNullable();
    t.uuid('department_id').nullable();
    t.uuid('designation_id').nullable();
    t.uuid('branch_id').nullable();
    t.uuid('manager_id').nullable();
    t.date('probation_start_date').nullable();
    t.date('probation_end_date').nullable();
    t.date('confirmation_date').nullable();
    t.date('resignation_date').nullable();
    t.date('termination_date').nullable();
    t.text('notes').nullable();
    timestamps(knex, t);
    softDelete(t);

    t.unique(['tenant_id', 'id']);
    t.foreign(['tenant_id', 'department_id'])
      .references(['tenant_id', 'id'])
      .inTable('departments')
      .onDelete('RESTRICT');
    t.foreign(['tenant_id', 'designation_id'])
      .references(['tenant_id', 'id'])
      .inTable('designations')
      .onDelete('RESTRICT');
    t.foreign(['tenant_id', 'branch_id'])
      .references(['tenant_id', 'id'])
      .inTable('branches')
      .onDelete('RESTRICT');
    t.foreign(['tenant_id', 'manager_id'])
      .references(['tenant_id', 'id'])
      .inTable('employees')
      .onDelete('RESTRICT');
    t.index(['tenant_id', 'status']);
    t.index(['tenant_id', 'department_id']);
    t.index(['tenant_id', 'manager_id']);
  });
  await knex.raw(`
    ALTER TABLE employees
      ADD CONSTRAINT employees_status_check CHECK (status IN (${list(EMPLOYEE_STATUSES)})),
      ADD CONSTRAINT employees_type_check CHECK (employment_type IN (${list(EMPLOYMENT_TYPES)})),
      ADD CONSTRAINT employees_gender_check CHECK (gender IS NULL OR gender IN (${list(GENDERS)})),
      ADD CONSTRAINT employees_not_own_manager CHECK (manager_id IS DISTINCT FROM id),
      ADD CONSTRAINT employees_probation_range CHECK (probation_end_date IS NULL OR probation_start_date IS NULL OR probation_end_date >= probation_start_date),
      ADD CONSTRAINT employees_dob_before_joining CHECK (date_of_birth IS NULL OR date_of_birth < joining_date);
    CREATE UNIQUE INDEX employees_tenant_number_unique ON employees (tenant_id, lower(employee_number)) WHERE deleted_at IS NULL;
    CREATE UNIQUE INDEX employees_tenant_email_unique ON employees (tenant_id, lower(email)) WHERE deleted_at IS NULL AND email IS NOT NULL;
    CREATE UNIQUE INDEX employees_tenant_user_unique ON employees (tenant_id, user_id) WHERE deleted_at IS NULL AND user_id IS NOT NULL;
  `);
  await updatedAtTrigger(knex, 'employees');

  // Append-only employment history: one row per changed attribute, with the effective date.
  await knex.schema.createTable('employee_history', (t) => {
    primaryUuid(knex, t);
    t.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.uuid('employee_id').notNullable();
    t.string('field', 30).notNullable();
    t.string('old_value', 100).nullable(); // id or enum value
    t.string('new_value', 100).nullable();
    t.date('effective_date').notNullable();
    t.string('reason', 500).nullable();
    t.uuid('changed_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.foreign(['tenant_id', 'employee_id'])
      .references(['tenant_id', 'id'])
      .inTable('employees')
      .onDelete('CASCADE');
    t.index(['tenant_id', 'employee_id', 'effective_date']);
  });
  await knex.raw(
    `ALTER TABLE employee_history ADD CONSTRAINT employee_history_field_check CHECK (field IN (${list(HISTORY_FIELDS)}))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('employee_history');
  await knex.schema.dropTableIfExists('employees');
}
