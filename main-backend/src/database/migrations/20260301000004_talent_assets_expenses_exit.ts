import type { Knex } from 'knex';
import { sqlList as list, tenantRef, tenantTable } from '../migration-helpers';

export const APPLICATION_STAGES = [
  'applied',
  'screening',
  'interview',
  'offered',
  'hired',
  'rejected',
  'withdrawn',
] as const;
export const ASSET_CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged'] as const;
export const EXPENSE_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'reimbursed',
] as const;
export const EXIT_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'completed'] as const;

/** Stage 6: recruitment, performance, training, assets, expenses and exit management. */
export async function up(knex: Knex): Promise<void> {
  // ── Recruitment ───────────────────────────────────────────────
  await tenantTable(knex, 'vacancies', (t) => {
    t.string('code', 30).notNullable();
    t.string('title', 150).notNullable();
    t.text('description').nullable();
    tenantRef(t, 'department_id', 'departments', 'RESTRICT', true);
    tenantRef(t, 'designation_id', 'designations', 'RESTRICT', true);
    tenantRef(t, 'branch_id', 'branches', 'RESTRICT', true);
    t.string('employment_type', 20).notNullable().defaultTo('permanent');
    t.smallint('openings').notNullable().defaultTo(1);
    t.date('closing_date').nullable();
    t.string('status', 10).notNullable().defaultTo('draft');
    t.unique(['tenant_id', 'code']);
  });
  await tenantTable(knex, 'applicants', (t) => {
    t.string('first_name', 100).notNullable();
    t.string('last_name', 100).notNullable();
    t.string('email', 255).notNullable();
    t.string('phone', 30).nullable();
    tenantRef(t, 'cv_file_id', 'files', 'SET NULL', true);
    t.string('notes', 1000).nullable();
  });
  await tenantTable(knex, 'job_applications', (t) => {
    tenantRef(t, 'vacancy_id', 'vacancies', 'CASCADE');
    tenantRef(t, 'applicant_id', 'applicants', 'CASCADE');
    t.string('stage', 12).notNullable().defaultTo('applied');
    t.smallint('rating').nullable();
    t.decimal('offer_salary', 14, 2).nullable();
    t.date('offer_start_date').nullable();
    t.string('offer_status', 10).nullable(); // pending | accepted | declined
    tenantRef(t, 'employee_id', 'employees', 'SET NULL', true); // set on hire
    t.string('notes', 1000).nullable();
    t.unique(['tenant_id', 'vacancy_id', 'applicant_id']);
  });
  await tenantTable(knex, 'interviews', (t) => {
    tenantRef(t, 'application_id', 'job_applications', 'CASCADE');
    t.timestamp('scheduled_at', { useTz: true }).notNullable();
    t.smallint('duration_minutes').notNullable().defaultTo(60);
    tenantRef(t, 'interviewer_id', 'employees', 'SET NULL', true);
    t.string('mode', 10).notNullable().defaultTo('onsite');
    t.string('location', 300).nullable();
    t.string('status', 10).notNullable().defaultTo('scheduled');
    t.smallint('score').nullable();
    t.string('recommendation', 10).nullable();
    t.string('feedback', 2000).nullable();
  });

  // ── Performance ───────────────────────────────────────────────
  await tenantTable(knex, 'performance_cycles', (t) => {
    t.string('name', 100).notNullable();
    t.date('start_date').notNullable();
    t.date('end_date').notNullable();
    t.string('status', 10).notNullable().defaultTo('draft');
    t.unique(['tenant_id', 'name']);
  });
  await tenantTable(knex, 'performance_reviews', (t) => {
    tenantRef(t, 'cycle_id', 'performance_cycles', 'CASCADE');
    tenantRef(t, 'employee_id', 'employees', 'CASCADE');
    tenantRef(t, 'reviewer_id', 'employees', 'SET NULL', true);
    t.decimal('self_rating', 3, 1).nullable();
    t.text('self_comments').nullable();
    t.decimal('manager_rating', 3, 1).nullable();
    t.text('manager_comments').nullable();
    t.decimal('final_rating', 3, 1).nullable();
    t.string('status', 16).notNullable().defaultTo('self_review');
    t.unique(['tenant_id', 'cycle_id', 'employee_id']);
  });
  await tenantTable(knex, 'performance_goals', (t) => {
    tenantRef(t, 'review_id', 'performance_reviews', 'CASCADE');
    t.string('title', 200).notNullable();
    t.string('kpi', 200).nullable();
    t.string('target', 100).nullable();
    t.smallint('weight').notNullable().defaultTo(0);
    t.string('achievement', 200).nullable();
    t.decimal('rating', 3, 1).nullable();
  });
  await tenantTable(
    knex,
    'performance_feedback',
    (t) => {
      tenantRef(t, 'employee_id', 'employees', 'CASCADE');
      t.uuid('author_id').nullable().references('id').inTable('users').onDelete('SET NULL');
      tenantRef(t, 'cycle_id', 'performance_cycles', 'SET NULL', true);
      t.string('content', 2000).notNullable();
    },
    { updatedAt: false },
  );

  // ── Training ──────────────────────────────────────────────────
  await tenantTable(knex, 'training_programs', (t) => {
    t.string('code', 30).notNullable();
    t.string('title', 150).notNullable();
    t.string('description', 2000).nullable();
    t.string('provider', 150).nullable();
    t.date('start_date').nullable();
    t.date('end_date').nullable();
    t.smallint('capacity').nullable();
    t.string('certification_name', 150).nullable();
    t.smallint('certificate_validity_months').nullable();
    t.string('status', 10).notNullable().defaultTo('planned');
    t.unique(['tenant_id', 'code']);
  });
  await tenantTable(knex, 'training_enrollments', (t) => {
    tenantRef(t, 'program_id', 'training_programs', 'CASCADE');
    tenantRef(t, 'employee_id', 'employees', 'CASCADE');
    t.string('status', 10).notNullable().defaultTo('enrolled');
    t.date('completed_on').nullable();
    t.smallint('score').nullable();
    t.date('certificate_expires_on').nullable();
    tenantRef(t, 'certificate_file_id', 'files', 'SET NULL', true);
    t.unique(['tenant_id', 'program_id', 'employee_id']);
  });

  // ── Assets ────────────────────────────────────────────────────
  await tenantTable(knex, 'asset_categories', (t) => {
    t.string('code', 20).notNullable();
    t.string('name', 100).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.unique(['tenant_id', 'code']);
  });
  await tenantTable(knex, 'assets', (t) => {
    tenantRef(t, 'category_id', 'asset_categories', 'RESTRICT');
    t.string('asset_tag', 40).notNullable();
    t.string('name', 150).notNullable();
    t.string('serial_number', 100).nullable();
    t.date('purchase_date').nullable();
    t.decimal('purchase_cost', 14, 2).nullable();
    t.string('condition', 10).notNullable().defaultTo('good');
    t.string('status', 12).notNullable().defaultTo('available');
    t.string('notes', 1000).nullable();
    t.unique(['tenant_id', 'asset_tag']);
  });
  await tenantTable(knex, 'asset_assignments', (t) => {
    tenantRef(t, 'asset_id', 'assets', 'CASCADE');
    tenantRef(t, 'employee_id', 'employees', 'CASCADE');
    t.date('assigned_on').notNullable();
    t.date('expected_return_on').nullable();
    t.date('returned_on').nullable();
    t.string('condition_out', 10).notNullable();
    t.string('condition_in', 10).nullable();
    t.string('notes', 500).nullable();
    t.uuid('assigned_by').nullable().references('id').inTable('users').onDelete('SET NULL');
  });

  // ── Expenses ──────────────────────────────────────────────────
  await tenantTable(knex, 'expense_categories', (t) => {
    t.string('code', 20).notNullable();
    t.string('name', 100).notNullable();
    t.decimal('max_amount', 14, 2).nullable();
    t.boolean('requires_receipt').notNullable().defaultTo(true);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.unique(['tenant_id', 'code']);
  });
  await tenantTable(knex, 'expense_claims', (t) => {
    tenantRef(t, 'employee_id', 'employees', 'CASCADE');
    tenantRef(t, 'category_id', 'expense_categories', 'RESTRICT');
    t.date('expense_date').notNullable();
    t.decimal('amount', 14, 2).notNullable();
    t.string('description', 1000).notNullable();
    tenantRef(t, 'receipt_file_id', 'files', 'SET NULL', true);
    t.string('status', 12).notNullable().defaultTo('pending');
    t.date('reimbursed_on').nullable();
    t.string('payment_reference', 100).nullable();
    t.uuid('requested_by').nullable().references('id').inTable('users').onDelete('SET NULL');
  });

  // ── Exit management ───────────────────────────────────────────
  await tenantTable(knex, 'exit_cases', (t) => {
    tenantRef(t, 'employee_id', 'employees', 'CASCADE');
    t.string('exit_type', 12).notNullable(); // resignation | termination
    t.date('notice_date').notNullable();
    t.smallint('notice_days').notNullable().defaultTo(30);
    t.date('last_working_day').notNullable();
    t.string('reason', 2000).nullable();
    t.string('status', 12).notNullable().defaultTo('pending');
    t.date('interview_date').nullable();
    t.text('interview_notes').nullable();
    t.decimal('settlement_earnings', 14, 2).nullable();
    t.decimal('settlement_deductions', 14, 2).nullable();
    t.decimal('settlement_net', 14, 2).nullable();
    t.date('settlement_paid_on').nullable();
    t.string('settlement_notes', 1000).nullable();
    t.uuid('requested_by').nullable().references('id').inTable('users').onDelete('SET NULL');
  });
  await tenantTable(knex, 'exit_clearances', (t) => {
    tenantRef(t, 'exit_case_id', 'exit_cases', 'CASCADE');
    t.string('area', 50).notNullable();
    t.boolean('is_cleared').notNullable().defaultTo(false);
    t.string('notes', 500).nullable();
    t.uuid('cleared_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('cleared_at', { useTz: true }).nullable();
    t.unique(['exit_case_id', 'area']);
  });

  await knex.raw(`
    ALTER TABLE vacancies
      ADD CONSTRAINT vacancies_status CHECK (status IN ('draft','open','closed','filled')),
      ADD CONSTRAINT vacancies_openings CHECK (openings >= 1);
    CREATE UNIQUE INDEX applicants_email_unique ON applicants (tenant_id, lower(email));
    ALTER TABLE job_applications
      ADD CONSTRAINT applications_stage CHECK (stage IN (${list(APPLICATION_STAGES)})),
      ADD CONSTRAINT applications_rating CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
      ADD CONSTRAINT applications_offer CHECK (offer_status IS NULL OR offer_status IN ('pending','accepted','declined'));
    ALTER TABLE interviews
      ADD CONSTRAINT interviews_status CHECK (status IN ('scheduled','completed','cancelled')),
      ADD CONSTRAINT interviews_mode CHECK (mode IN ('onsite','video','phone')),
      ADD CONSTRAINT interviews_score CHECK (score IS NULL OR score BETWEEN 1 AND 5),
      ADD CONSTRAINT interviews_rec CHECK (recommendation IS NULL OR recommendation IN ('hire','hold','reject'));
    ALTER TABLE performance_cycles
      ADD CONSTRAINT perf_cycles_status CHECK (status IN ('draft','active','closed')),
      ADD CONSTRAINT perf_cycles_dates CHECK (end_date >= start_date);
    ALTER TABLE performance_reviews
      ADD CONSTRAINT perf_reviews_status CHECK (status IN ('self_review','manager_review','completed')),
      ADD CONSTRAINT perf_reviews_ratings CHECK (
        (self_rating IS NULL OR self_rating BETWEEN 1 AND 5) AND
        (manager_rating IS NULL OR manager_rating BETWEEN 1 AND 5) AND
        (final_rating IS NULL OR final_rating BETWEEN 1 AND 5));
    ALTER TABLE performance_goals
      ADD CONSTRAINT perf_goals_weight CHECK (weight BETWEEN 0 AND 100),
      ADD CONSTRAINT perf_goals_rating CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);
    ALTER TABLE training_programs
      ADD CONSTRAINT training_status CHECK (status IN ('planned','ongoing','completed','cancelled')),
      ADD CONSTRAINT training_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);
    ALTER TABLE training_enrollments
      ADD CONSTRAINT enrollments_status CHECK (status IN ('enrolled','completed','failed','cancelled')),
      ADD CONSTRAINT enrollments_score CHECK (score IS NULL OR score BETWEEN 0 AND 100);
    ALTER TABLE assets
      ADD CONSTRAINT assets_condition CHECK (condition IN (${list(ASSET_CONDITIONS)})),
      ADD CONSTRAINT assets_status CHECK (status IN ('available','assigned','maintenance','retired'));
    ALTER TABLE asset_assignments
      ADD CONSTRAINT asset_assign_cond CHECK (condition_out IN (${list(ASSET_CONDITIONS)}) AND (condition_in IS NULL OR condition_in IN (${list(ASSET_CONDITIONS)}))),
      ADD CONSTRAINT asset_assign_dates CHECK (returned_on IS NULL OR returned_on >= assigned_on);
    -- An asset has at most one open assignment.
    CREATE UNIQUE INDEX asset_assignments_open ON asset_assignments (asset_id) WHERE returned_on IS NULL;
    ALTER TABLE expense_categories ADD CONSTRAINT expense_cat_max CHECK (max_amount IS NULL OR max_amount > 0);
    ALTER TABLE expense_claims
      ADD CONSTRAINT expense_claims_status CHECK (status IN (${list(EXPENSE_STATUSES)})),
      ADD CONSTRAINT expense_claims_amount CHECK (amount > 0);
    ALTER TABLE exit_cases
      ADD CONSTRAINT exit_cases_type CHECK (exit_type IN ('resignation','termination')),
      ADD CONSTRAINT exit_cases_status CHECK (status IN (${list(EXIT_STATUSES)})),
      ADD CONSTRAINT exit_cases_dates CHECK (last_working_day >= notice_date);
    -- One open exit case per employee.
    CREATE UNIQUE INDEX exit_cases_open ON exit_cases (tenant_id, employee_id) WHERE status IN ('pending','approved');
  `);
}

export async function down(knex: Knex): Promise<void> {
  for (const t of [
    'exit_clearances',
    'exit_cases',
    'expense_claims',
    'expense_categories',
    'asset_assignments',
    'assets',
    'asset_categories',
    'training_enrollments',
    'training_programs',
    'performance_feedback',
    'performance_goals',
    'performance_reviews',
    'performance_cycles',
    'interviews',
    'job_applications',
    'applicants',
    'vacancies',
  ])
    await knex.schema.dropTableIfExists(t);
}
