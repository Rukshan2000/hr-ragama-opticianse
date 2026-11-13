import type { Knex } from 'knex';
import { sqlList as list, tenantRef, tenantTable } from '../migration-helpers';

export const ATTENDANCE_STATUSES = [
  'present',
  'late',
  'half_day',
  'absent',
  'on_leave',
  'holiday',
  'off',
] as const;
export const ATTENDANCE_SOURCES = ['self', 'manual', 'admin', 'device', 'correction'] as const;
export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

/** Stage 3: shifts, rotational weekly schedules, attendance, holidays and leave. */
export async function up(knex: Knex): Promise<void> {
  await tenantTable(knex, 'shifts', (t) => {
    t.string('code', 30).notNullable();
    t.string('name', 100).notNullable();
    t.time('start_time').notNullable();
    t.time('end_time').notNullable(); // end <= start means the shift ends the next day
    t.smallint('break_minutes').notNullable().defaultTo(60);
    t.smallint('grace_minutes').notNullable().defaultTo(10);
    t.smallint('early_leave_grace_minutes').notNullable().defaultTo(0);
    t.string('color', 7).nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.unique(['tenant_id', 'code']);
  });

  // A schedule is a repeating pattern of N weeks; each day maps to a shift or is a day off.
  await tenantTable(knex, 'work_schedules', (t) => {
    t.string('name', 100).notNullable();
    t.smallint('rotation_weeks').notNullable().defaultTo(1);
    t.string('description', 500).nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.unique(['tenant_id', 'name']);
  });
  await tenantTable(
    knex,
    'work_schedule_days',
    (t) => {
      tenantRef(t, 'schedule_id', 'work_schedules', 'CASCADE');
      t.smallint('week_index').notNullable(); // 0..rotation_weeks-1
      t.smallint('weekday').notNullable(); // ISO 1=Mon..7=Sun
      tenantRef(t, 'shift_id', 'shifts', 'RESTRICT', true); // null = day off / weekend
      t.unique(['schedule_id', 'week_index', 'weekday']);
    },
    { updatedAt: false },
  );
  await tenantTable(knex, 'employee_schedules', (t) => {
    tenantRef(t, 'employee_id', 'employees', 'CASCADE');
    tenantRef(t, 'schedule_id', 'work_schedules', 'RESTRICT');
    t.date('effective_from').notNullable(); // also the rotation anchor (week 0)
    t.date('effective_to').nullable();
  });

  // Effective-dated attendance policy per tenant.
  await tenantTable(knex, 'attendance_policies', (t) => {
    t.date('effective_from').notNullable();
    t.smallint('overtime_threshold_minutes').notNullable().defaultTo(30);
    t.smallint('half_day_minutes').notNullable().defaultTo(240);
    t.boolean('count_weekend_as_overtime').notNullable().defaultTo(true);
    t.unique(['tenant_id', 'effective_from']);
  });

  await tenantTable(knex, 'attendance_records', (t) => {
    tenantRef(t, 'employee_id', 'employees', 'CASCADE');
    t.date('work_date').notNullable();
    tenantRef(t, 'shift_id', 'shifts', 'SET NULL', true);
    t.timestamp('scheduled_start', { useTz: true }).nullable();
    t.timestamp('scheduled_end', { useTz: true }).nullable();
    t.timestamp('check_in', { useTz: true }).nullable();
    t.timestamp('check_out', { useTz: true }).nullable();
    t.smallint('break_minutes').notNullable().defaultTo(0);
    t.integer('worked_minutes').notNullable().defaultTo(0);
    t.integer('late_minutes').notNullable().defaultTo(0);
    t.integer('early_leave_minutes').notNullable().defaultTo(0);
    t.integer('overtime_minutes').notNullable().defaultTo(0);
    t.string('status', 12).notNullable();
    t.string('source', 12).notNullable().defaultTo('manual');
    t.string('notes', 500).nullable();
    t.uuid('recorded_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.unique(['tenant_id', 'employee_id', 'work_date']);
    t.index(['tenant_id', 'work_date']);
  });

  await tenantTable(knex, 'attendance_corrections', (t) => {
    tenantRef(t, 'employee_id', 'employees', 'CASCADE');
    t.date('work_date').notNullable();
    t.timestamp('check_in', { useTz: true }).notNullable();
    t.timestamp('check_out', { useTz: true }).nullable();
    t.string('reason', 500).notNullable();
    t.string('status', 12).notNullable().defaultTo('pending');
    t.uuid('requested_by').nullable().references('id').inTable('users').onDelete('SET NULL');
  });

  await tenantTable(knex, 'holidays', (t) => {
    t.string('name', 150).notNullable();
    t.date('holiday_date').notNullable();
    t.string('type', 10).notNullable().defaultTo('public');
    tenantRef(t, 'branch_id', 'branches', 'CASCADE', true); // null = all branches
    t.boolean('is_recurring').notNullable().defaultTo(false); // same month/day every year
    t.string('description', 500).nullable();
    t.index(['tenant_id', 'holiday_date']);
  });

  await tenantTable(knex, 'leave_types', (t) => {
    t.string('code', 20).notNullable();
    t.string('name', 100).notNullable();
    t.boolean('is_paid').notNullable().defaultTo(true);
    t.boolean('allow_half_day').notNullable().defaultTo(true);
    t.boolean('allow_negative').notNullable().defaultTo(false);
    t.string('color', 7).nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.unique(['tenant_id', 'code']);
  });
  // Effective-dated entitlement policy, optionally per employment type.
  await tenantTable(knex, 'leave_policies', (t) => {
    tenantRef(t, 'leave_type_id', 'leave_types', 'CASCADE');
    t.string('employment_type', 20).nullable(); // null = all employment types
    t.decimal('annual_days', 5, 1).notNullable();
    t.string('accrual', 10).notNullable().defaultTo('annual'); // annual | monthly
    t.decimal('carry_forward_max', 5, 1).notNullable().defaultTo(0);
    t.date('effective_from').notNullable();
  });
  await tenantTable(knex, 'leave_balances', (t) => {
    tenantRef(t, 'employee_id', 'employees', 'CASCADE');
    tenantRef(t, 'leave_type_id', 'leave_types', 'CASCADE');
    t.smallint('year').notNullable();
    t.decimal('entitled', 6, 1).notNullable().defaultTo(0);
    t.decimal('carried_forward', 6, 1).notNullable().defaultTo(0);
    t.decimal('adjustment', 6, 1).notNullable().defaultTo(0);
    t.decimal('used', 6, 1).notNullable().defaultTo(0);
    t.decimal('pending', 6, 1).notNullable().defaultTo(0);
    t.unique(['tenant_id', 'employee_id', 'leave_type_id', 'year']);
  });
  await tenantTable(knex, 'leave_requests', (t) => {
    tenantRef(t, 'employee_id', 'employees', 'CASCADE');
    tenantRef(t, 'leave_type_id', 'leave_types', 'RESTRICT');
    t.date('start_date').notNullable();
    t.date('end_date').notNullable();
    t.string('half_day', 2).nullable(); // am | pm, single-day only
    t.decimal('days', 5, 1).notNullable();
    t.string('reason', 1000).nullable();
    t.string('status', 12).notNullable().defaultTo('pending');
    t.string('decision_comment', 1000).nullable();
    t.uuid('requested_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.index(['tenant_id', 'start_date']);
  });

  await knex.raw(`
    ALTER TABLE shifts ADD CONSTRAINT shifts_minutes_check CHECK (break_minutes BETWEEN 0 AND 600 AND grace_minutes BETWEEN 0 AND 240 AND early_leave_grace_minutes BETWEEN 0 AND 240);
    ALTER TABLE work_schedules ADD CONSTRAINT work_schedules_weeks_check CHECK (rotation_weeks BETWEEN 1 AND 8);
    ALTER TABLE work_schedule_days ADD CONSTRAINT schedule_days_check CHECK (weekday BETWEEN 1 AND 7 AND week_index >= 0);
    ALTER TABLE employee_schedules
      ADD CONSTRAINT employee_schedules_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
      ADD CONSTRAINT employee_schedules_no_overlap EXCLUDE USING gist (
        tenant_id WITH =, employee_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&);
    ALTER TABLE attendance_records
      ADD CONSTRAINT attendance_status_check CHECK (status IN (${list(ATTENDANCE_STATUSES)})),
      ADD CONSTRAINT attendance_source_check CHECK (source IN (${list(ATTENDANCE_SOURCES)})),
      ADD CONSTRAINT attendance_times_check CHECK (check_out IS NULL OR check_in IS NULL OR check_out > check_in);
    ALTER TABLE attendance_corrections
      ADD CONSTRAINT attendance_corrections_status CHECK (status IN (${list(LEAVE_STATUSES)})),
      ADD CONSTRAINT attendance_corrections_times CHECK (check_out IS NULL OR check_out > check_in);
    ALTER TABLE holidays ADD CONSTRAINT holidays_type_check CHECK (type IN ('public','company'));
    CREATE UNIQUE INDEX holidays_unique ON holidays (tenant_id, holiday_date, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));
    ALTER TABLE leave_policies
      ADD CONSTRAINT leave_policies_accrual CHECK (accrual IN ('annual','monthly')),
      ADD CONSTRAINT leave_policies_days CHECK (annual_days >= 0 AND carry_forward_max >= 0);
    CREATE UNIQUE INDEX leave_policies_unique ON leave_policies (tenant_id, leave_type_id, COALESCE(employment_type, '*'), effective_from);
    ALTER TABLE leave_requests
      ADD CONSTRAINT leave_requests_status CHECK (status IN (${list(LEAVE_STATUSES)})),
      ADD CONSTRAINT leave_requests_dates CHECK (end_date >= start_date AND days > 0),
      ADD CONSTRAINT leave_requests_half_day CHECK (half_day IS NULL OR (half_day IN ('am','pm') AND start_date = end_date)),
      -- No two live (pending/approved) requests of an employee may overlap.
      ADD CONSTRAINT leave_requests_no_overlap EXCLUDE USING gist (
        tenant_id WITH =, employee_id WITH =, daterange(start_date, end_date, '[]') WITH &&
      ) WHERE (status IN ('pending','approved') AND half_day IS NULL);
  `);
}

export async function down(knex: Knex): Promise<void> {
  for (const t of [
    'leave_requests',
    'leave_balances',
    'leave_policies',
    'leave_types',
    'holidays',
    'attendance_corrections',
    'attendance_records',
    'attendance_policies',
    'employee_schedules',
    'work_schedule_days',
    'work_schedules',
    'shifts',
  ])
    await knex.schema.dropTableIfExists(t);
}
