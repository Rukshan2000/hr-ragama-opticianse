import { db, type DbExecutor } from '../../database/knex';
import { likeTerm, paginate } from '../../shared/utils/pagination';
import { tenantScope } from '../../shared/utils/tenant-scope';
import type { ListEmployeesQuery } from './employees.schema';

export interface EmployeeRow {
  id: string;
  user_id: string | null;
  employee_number: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  gender: string | null;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  status: string;
  employment_type: string;
  joining_date: string;
  department_id: string | null;
  department_name: string | null;
  designation_id: string | null;
  designation_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
  manager_id: string | null;
  manager_name: string | null;
  manager_number: string | null;
  probation_start_date: string | null;
  probation_end_date: string | null;
  confirmation_date: string | null;
  resignation_date: string | null;
  termination_date: string | null;
  notes: string | null;
  photo_file_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const SORT = {
  name: 'e.first_name',
  employeeNumber: 'e.employee_number',
  joiningDate: 'e.joining_date',
  createdAt: 'e.created_at',
} as const;

function employeesQuery(executor: DbExecutor, tenantId: string) {
  return tenantScope(executor, 'employees as e', tenantId)
    .whereNull('e.deleted_at')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .leftJoin('designations as g', 'g.id', 'e.designation_id')
    .leftJoin('branches as b', 'b.id', 'e.branch_id')
    .leftJoin('employees as m', 'm.id', 'e.manager_id')
    .select(
      'e.*',
      'd.name as department_name',
      'g.name as designation_name',
      'b.name as branch_name',
      executor.raw(`m.first_name || ' ' || m.last_name as manager_name`),
      'm.employee_number as manager_number',
    );
}

export interface HistoryRow {
  id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  effective_date: string;
  reason: string | null;
  changed_by: string | null;
  changed_by_name: string | null;
  created_at: Date;
}

export const employeesRepository = {
  list(tenantId: string, q: ListEmployeesQuery) {
    const base = employeesQuery(db, tenantId).modify((qb) => {
      if (q.search) {
        const term = likeTerm(q.search);
        qb.where((w) =>
          w
            .whereILike('e.employee_number', term)
            .orWhereILike('e.email', term)
            .orWhereRaw(`(e.first_name || ' ' || e.last_name) ILIKE ?`, [term])
            .orWhereILike('e.display_name', term),
        );
      }
      if (q.status) qb.where('e.status', q.status);
      if (q.employmentType) qb.where('e.employment_type', q.employmentType);
      if (q.departmentId) qb.where('e.department_id', q.departmentId);
      if (q.designationId) qb.where('e.designation_id', q.designationId);
      if (q.branchId) qb.where('e.branch_id', q.branchId);
      if (q.managerId) qb.where('e.manager_id', q.managerId);
    });
    return paginate<EmployeeRow>(base, q, { column: SORT[q.sort], order: q.order });
  },

  findById(
    tenantId: string,
    id: string,
    executor: DbExecutor = db,
  ): Promise<EmployeeRow | undefined> {
    return employeesQuery(executor, tenantId).where('e.id', id).first();
  },

  /** Row lock for read-modify-write (assignment/status) so concurrent edits serialise. */
  async lock(tenantId: string, id: string, trx: DbExecutor) {
    return tenantScope(trx, 'employees', tenantId)
      .whereNull('deleted_at')
      .where({ id })
      .forUpdate()
      .first<Record<string, string | null> | undefined>();
  },

  /** Returns how many of the given ids exist (and are live) in the tenant's table. */
  async countExisting(
    tenantId: string,
    table: 'departments' | 'designations' | 'branches' | 'employees',
    id: string,
  ) {
    const q = tenantScope(db, table, tenantId).where({ id });
    if (table === 'employees') q.whereNull('deleted_at');
    return Boolean(await q.first('id'));
  },

  /** True if `managerId`'s reporting chain reaches `employeeId` (assigning would form a loop). */
  async managerChainIncludes(
    tenantId: string,
    managerId: string,
    employeeId: string,
    executor: DbExecutor,
  ) {
    const { rows } = await executor.raw<{ rows: unknown[] }>(
      `WITH RECURSIVE chain AS (
         SELECT id, manager_id, 1 AS depth FROM employees WHERE tenant_id = ? AND id = ?
         UNION ALL
         SELECT e.id, e.manager_id, c.depth + 1 FROM employees e
           JOIN chain c ON e.id = c.manager_id
          WHERE e.tenant_id = ? AND c.depth < 100
       ) SELECT 1 FROM chain WHERE id = ? LIMIT 1`,
      [tenantId, managerId, tenantId, employeeId],
    );
    return rows.length > 0;
  },

  async insert(tenantId: string, data: Record<string, unknown>, executor: DbExecutor) {
    const [row] = await executor('employees')
      .insert({ ...data, tenant_id: tenantId })
      .returning<{ id: string }[]>('id');
    return row!.id;
  },

  async update(
    tenantId: string,
    id: string,
    data: Record<string, unknown>,
    executor: DbExecutor = db,
  ) {
    return tenantScope(executor, 'employees', tenantId)
      .whereNull('deleted_at')
      .where({ id })
      .update(data);
  },

  async softDelete(tenantId: string, id: string) {
    return tenantScope(db, 'employees', tenantId)
      .whereNull('deleted_at')
      .where({ id })
      .update({ deleted_at: db.fn.now() });
  },

  async hasDirectReports(tenantId: string, id: string) {
    return Boolean(
      await tenantScope(db, 'employees', tenantId)
        .whereNull('deleted_at')
        .where({ manager_id: id })
        .first('id'),
    );
  },

  async addHistory(
    tenantId: string,
    rows: {
      employee_id: string;
      field: string;
      old_value: string | null;
      new_value: string | null;
      effective_date: string;
      reason?: string | null;
      changed_by: string;
    }[],
    executor: DbExecutor,
  ) {
    if (rows.length)
      await executor('employee_history').insert(rows.map((r) => ({ ...r, tenant_id: tenantId })));
  },

  /** History with the referenced ids resolved to names in the same query. */
  history(
    tenantId: string,
    employeeId: string,
  ): Promise<(HistoryRow & { old_label: string | null; new_label: string | null })[]> {
    const label = (side: 'old' | 'new') =>
      db.raw(
        `CASE h.field
           WHEN 'department' THEN (SELECT name FROM departments WHERE id::text = h.${side}_value AND tenant_id = h.tenant_id)
           WHEN 'designation' THEN (SELECT name FROM designations WHERE id::text = h.${side}_value AND tenant_id = h.tenant_id)
           WHEN 'branch' THEN (SELECT name FROM branches WHERE id::text = h.${side}_value AND tenant_id = h.tenant_id)
           WHEN 'manager' THEN (SELECT first_name || ' ' || last_name FROM employees WHERE id::text = h.${side}_value AND tenant_id = h.tenant_id)
           ELSE h.${side}_value END AS ${side}_label`,
      );
    return tenantScope(db, 'employee_history as h', tenantId)
      .leftJoin('users as u', 'u.id', 'h.changed_by')
      .where('h.employee_id', employeeId)
      .select('h.*', 'u.name as changed_by_name', label('old'), label('new'))
      .orderBy([
        { column: 'h.effective_date', order: 'desc' },
        { column: 'h.created_at', order: 'desc' },
      ]);
  },
};
