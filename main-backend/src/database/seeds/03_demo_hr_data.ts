import type { Knex } from 'knex';
import { env } from '../../config/env';

/** Development-only HR sample data for the first tenant. Idempotent: skips if any branch exists. */
export async function seed(knex: Knex): Promise<void> {
  if (env.NODE_ENV !== 'development') return;
  const tenant = await knex('tenants').orderBy('created_at').first('id');
  if (!tenant || (await knex('branches').where({ tenant_id: tenant.id }).first('id'))) return;
  const tenant_id = tenant.id as string;

  await knex.transaction(async (trx) => {
    const ins = async (table: string, rows: object[]) =>
      (
        await trx(table)
          .insert(rows.map((r) => ({ ...r, tenant_id })))
          .returning<{ id: string }[]>('id')
      ).map((r) => r.id);

    const [hq, kandy] = await ins('branches', [
      { code: 'HQ', name: 'Head Office', address: 'Ragama', timezone: 'Asia/Colombo' },
      { code: 'KDY', name: 'Kandy Branch', address: 'Kandy', timezone: 'Asia/Colombo' },
    ]);
    const [hr, eng, fin] = await ins('departments', [
      { code: 'HR', name: 'Human Resources' },
      { code: 'ENG', name: 'Engineering' },
      { code: 'FIN', name: 'Finance' },
    ]);
    const [ceoT, hrm, se, acc] = await ins('designations', [
      { code: 'CEO', name: 'Chief Executive Officer' },
      { code: 'HRM', name: 'HR Manager' },
      { code: 'SE', name: 'Software Engineer' },
      { code: 'ACC', name: 'Accountant' },
    ]);
    const [company, division, unit] = await ins('org_levels', [
      { name: 'Company', rank: 1 },
      { name: 'Division', rank: 2 },
      { name: 'Department', rank: 3 },
    ]);
    const [root] = await ins('org_units', [{ name: 'HR Ragama', level_id: company }]);
    const [ops, tech] = await ins('org_units', [
      { name: 'Corporate Services', level_id: division, parent_id: root, sort_order: 1 },
      { name: 'Technology', level_id: division, parent_id: root, sort_order: 2 },
    ]);
    await ins('org_units', [
      { name: 'Human Resources', level_id: unit, parent_id: ops, department_id: hr },
      { name: 'Finance', level_id: unit, parent_id: ops, department_id: fin },
      { name: 'Engineering', level_id: unit, parent_id: tech, department_id: eng },
    ]);

    const person = (n: string, first: string, last: string, extra: object) => ({
      employee_number: n,
      first_name: first,
      last_name: last,
      email: `${first}.${last}@example.lk`.toLowerCase(),
      status: 'active',
      joining_date: '2023-01-02',
      branch_id: hq,
      ...extra,
    });
    const [ceo] = await ins('employees', [
      person('EMP-0001', 'Kamal', 'Fernando', { designation_id: ceoT }),
    ]);
    const [hrLead] = await ins('employees', [
      person('EMP-0002', 'Dilani', 'Silva', {
        department_id: hr,
        designation_id: hrm,
        manager_id: ceo,
      }),
    ]);
    await ins('employees', [
      person('EMP-0003', 'Nuwan', 'Jayasinghe', {
        department_id: eng,
        designation_id: se,
        manager_id: ceo,
        date_of_birth: '1994-11-20',
      }),
      person('EMP-0004', 'Ishara', 'Wickramasinghe', {
        department_id: eng,
        designation_id: se,
        manager_id: ceo,
        branch_id: kandy,
        status: 'probation',
        joining_date: '2026-09-01',
        probation_start_date: '2026-09-01',
        probation_end_date: '2027-02-28',
      }),
      person('EMP-0005', 'Ruwan', 'Bandara', {
        department_id: fin,
        designation_id: acc,
        manager_id: hrLead,
        status: 'onboarding',
        joining_date: '2026-11-17',
      }),
    ]);
  });
}
