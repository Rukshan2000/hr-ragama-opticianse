import type { Knex } from 'knex';
import { env } from '../../config/env';

/**
 * Development-only configuration for the stage 3–8 modules on the first tenant.
 * Idempotent: skips if the tenant already has leave types.
 *
 * Statutory figures below are SAMPLE values for local testing (EPF 8%/12%, ETF 3%, APIT monthly
 * slabs per the 2025/26 schedule). They are ordinary effective-dated rows that payroll
 * administrators must verify and maintain; nothing in the code depends on them.
 */
export async function seed(knex: Knex): Promise<void> {
  if (env.NODE_ENV !== 'development') return;
  const tenant = await knex('tenants').orderBy('created_at').first('id');
  if (!tenant || (await knex('leave_types').where({ tenant_id: tenant.id }).first('id'))) return;
  const tenant_id = tenant.id as string;

  await knex.transaction(async (trx) => {
    const ins = async (table: string, rows: object[]) =>
      (
        await trx(table)
          .insert(rows.map((r) => ({ ...r, tenant_id })))
          .returning<{ id: string }[]>('id')
      ).map((r) => r.id);

    await trx('tenant_settings').insert({ tenant_id }).onConflict('tenant_id').ignore();

    // Time
    const [general] = await ins('shifts', [
      {
        code: 'GEN',
        name: 'General',
        start_time: '08:30',
        end_time: '17:30',
        break_minutes: 60,
        grace_minutes: 10,
        color: '#2563eb',
      },
      {
        code: 'NIGHT',
        name: 'Night',
        start_time: '22:00',
        end_time: '06:00',
        break_minutes: 30,
        grace_minutes: 5,
        color: '#7c3aed',
      },
    ]);
    const [office] = await ins('work_schedules', [{ name: 'Office (Mon–Fri)', rotation_weeks: 1 }]);
    await ins('work_schedules', [{ name: 'Rotating nights (2 weeks)', rotation_weeks: 2 }]);
    await trx('work_schedule_days').insert(
      [1, 2, 3, 4, 5].map((weekday) => ({
        tenant_id,
        schedule_id: office,
        week_index: 0,
        weekday,
        shift_id: general,
      })),
    );
    await ins('attendance_policies', [
      { effective_from: '2024-01-01', overtime_threshold_minutes: 30, half_day_minutes: 240 },
    ]);
    const employees = (await trx('employees')
      .where({ tenant_id })
      .whereNull('deleted_at')
      .pluck('id')) as string[];
    if (employees.length)
      await trx('employee_schedules').insert(
        employees.map((employee_id) => ({
          tenant_id,
          employee_id,
          schedule_id: office,
          effective_from: '2024-01-01',
        })),
      );

    const year = new Date().getFullYear();
    await ins('holidays', [
      { name: 'Tamil Thai Pongal Day', holiday_date: `${year}-01-14`, type: 'public' },
      { name: 'Independence Day', holiday_date: '2024-02-04', type: 'public', is_recurring: true },
      { name: 'May Day', holiday_date: '2024-05-01', type: 'public', is_recurring: true },
      { name: 'Christmas Day', holiday_date: '2024-12-25', type: 'public', is_recurring: true },
      { name: 'Company Anniversary', holiday_date: `${year}-09-15`, type: 'company' },
    ]);

    const [annual, casual, medical] = await ins('leave_types', [
      { code: 'AL', name: 'Annual leave', color: '#16a34a' },
      { code: 'CL', name: 'Casual leave', color: '#0891b2' },
      { code: 'ML', name: 'Medical leave', color: '#dc2626', allow_half_day: false },
      { code: 'NP', name: 'No-pay leave', color: '#64748b', is_paid: false, allow_negative: true },
    ]);
    await ins('leave_policies', [
      {
        leave_type_id: annual,
        annual_days: 14,
        accrual: 'annual',
        carry_forward_max: 5,
        effective_from: '2024-01-01',
      },
      { leave_type_id: casual, annual_days: 7, effective_from: '2024-01-01' },
      { leave_type_id: medical, annual_days: 7, effective_from: '2024-01-01' },
      {
        leave_type_id: annual,
        employment_type: 'internship',
        annual_days: 7,
        accrual: 'monthly',
        effective_from: '2024-01-01',
      },
    ]);

    // Payroll (sample statutory configuration — verify before real use)
    await ins('payroll_policies', [
      {
        effective_from: '2025-04-01',
        epf_employee_rate: 8,
        epf_employer_rate: 12,
        etf_rate: 3,
        overtime_multiplier: 1.5,
        working_days_per_month: 30,
        working_hours_per_day: 8,
        apit_brackets: JSON.stringify([
          { upTo: 150000, rate: 0 },
          { upTo: 233333, rate: 6 },
          { upTo: 275000, rate: 18 },
          { upTo: 316667, rate: 24 },
          { upTo: 358333, rate: 30 },
          { upTo: null, rate: 36 },
        ]),
        notes: 'Sample values for development. Verify against current Inland Revenue / EPF rules.',
      },
    ]);
    const [transport] = await ins('salary_components', [
      { code: 'TRN', name: 'Transport allowance', kind: 'earning', is_taxable: true },
      {
        code: 'BRA',
        name: 'Budgetary relief allowance',
        kind: 'earning',
        is_taxable: true,
        is_epf_applicable: true,
      },
      { code: 'WEL', name: 'Welfare society', kind: 'deduction', is_taxable: false },
    ]);
    for (const [i, employee_id] of employees.entries()) {
      const [s] = await ins('employee_salaries', [
        {
          employee_id,
          effective_from: '2024-01-01',
          basic_salary: 120000 + i * 35000,
          reason: 'Initial salary',
        },
      ]);
      await trx('employee_salary_items').insert({
        tenant_id,
        salary_id: s,
        component_id: transport,
        amount: 10000,
      });
    }

    // Checklists, assets, expenses, training, announcements
    await ins('checklist_templates', [
      {
        kind: 'onboarding',
        title: 'Collect NIC copy and bank details',
        due_days: 0,
        sort_order: 1,
      },
      { kind: 'onboarding', title: 'Issue laptop and email account', due_days: 1, sort_order: 2 },
      { kind: 'onboarding', title: 'Workplace safety induction', due_days: 3, sort_order: 3 },
      {
        kind: 'onboarding',
        title: 'Probation goals agreed with manager',
        due_days: 14,
        sort_order: 4,
      },
      { kind: 'exit', title: 'Knowledge handover completed', due_days: -5, sort_order: 1 },
      { kind: 'exit', title: 'Exit interview held', due_days: -2, sort_order: 2 },
      { kind: 'exit', title: 'Revoke system access', due_days: 0, sort_order: 3 },
    ]);
    await ins('asset_categories', [
      { code: 'LAP', name: 'Laptops' },
      { code: 'PHN', name: 'Mobile phones' },
      { code: 'EQP', name: 'Optical equipment' },
    ]);
    await ins('expense_categories', [
      { code: 'TRV', name: 'Travel', max_amount: 25000, requires_receipt: false },
      { code: 'MEAL', name: 'Meals', max_amount: 5000 },
      { code: 'TRN', name: 'Training & courses' },
    ]);
    await ins('training_programs', [
      {
        code: 'FA-01',
        title: 'First aid at work',
        provider: 'Red Cross',
        certification_name: 'First Aid Certificate',
        certificate_validity_months: 24,
        status: 'planned',
      },
    ]);
    await ins('announcements', [
      {
        title: 'Welcome to the HR portal',
        body: 'Apply for leave, check your attendance and download payslips from "My workspace".',
        publish_on: `${year}-01-01`,
        is_pinned: true,
      },
    ]);
  });
}
