import { withTransaction, type DbExecutor } from '../../database/knex';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors/app-error';
import type { AuthContext } from '../../shared/types/auth';
import { toSnake } from '../../shared/utils/case';
import {
  isCheckViolation,
  isForeignKeyViolation,
  isUniqueViolation,
} from '../../shared/utils/db-errors';
import { requireTenantId } from '../../shared/utils/tenant-scope';
import { employeesRepository as repo, type EmployeeRow } from './employees.repository';
import {
  STATUS_TRANSITIONS,
  type AssignmentBody,
  type CreateEmployeeBody,
  type EmployeeStatus,
  type ListEmployeesQuery,
  type StatusBody,
  type UpdateEmployeeBody,
} from './employees.schema';

const ref = (id: string | null, name: string | null) => (id ? { id, name } : null);

export function toEmployeeDto(e: EmployeeRow) {
  return {
    id: e.id,
    employeeNumber: e.employee_number,
    firstName: e.first_name,
    lastName: e.last_name,
    displayName: e.display_name,
    fullName: `${e.first_name} ${e.last_name}`,
    email: e.email,
    phone: e.phone,
    dateOfBirth: e.date_of_birth,
    gender: e.gender,
    address: e.address,
    emergencyContact: {
      name: e.emergency_contact_name,
      phone: e.emergency_contact_phone,
      relationship: e.emergency_contact_relationship,
    },
    status: e.status,
    employmentType: e.employment_type,
    joiningDate: e.joining_date,
    department: ref(e.department_id, e.department_name),
    designation: ref(e.designation_id, e.designation_name),
    branch: ref(e.branch_id, e.branch_name),
    manager: e.manager_id
      ? { id: e.manager_id, name: e.manager_name, employeeNumber: e.manager_number }
      : null,
    probationStartDate: e.probation_start_date,
    probationEndDate: e.probation_end_date,
    confirmationDate: e.confirmation_date,
    resignationDate: e.resignation_date,
    terminationDate: e.termination_date,
    notes: e.notes,
    hasAccount: Boolean(e.user_id),
    photoFileId: e.photo_file_id,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
  };
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isUniqueViolation(err)) {
      const c = (err as { constraint?: string }).constraint ?? '';
      throw new ConflictError(
        c.includes('email')
          ? 'Another employee already uses this email'
          : 'This employee number is already in use',
      );
    }
    if (isForeignKeyViolation(err))
      throw new BadRequestError(
        'A referenced department, designation, branch or manager does not exist',
      );
    if (isCheckViolation(err)) throw new BadRequestError('The dates or values are inconsistent');
    throw err;
  }
}

const REFS = [
  ['departmentId', 'departments', 'department'],
  ['designationId', 'designations', 'designation'],
  ['branchId', 'branches', 'branch'],
  ['managerId', 'employees', 'manager'],
] as const;

/** Rejects references to records that don't exist in this tenant (400, never leaks other tenants). */
async function assertRefs(
  tenantId: string,
  input: Partial<Record<(typeof REFS)[number][0], string | null>>,
) {
  for (const [key, table, label] of REFS) {
    const id = input[key];
    if (id && !(await repo.countExisting(tenantId, table, id))) {
      throw new BadRequestError(`Unknown ${label}`, [{ field: key, message: `Unknown ${label}` }]);
    }
  }
}

async function assertNoManagerLoop(
  tenantId: string,
  employeeId: string,
  managerId: string,
  trx: DbExecutor,
) {
  if (managerId === employeeId)
    throw new BadRequestError('An employee cannot report to themselves');
  if (await repo.managerChainIncludes(tenantId, managerId, employeeId, trx)) {
    throw new BadRequestError(
      'This manager already reports (directly or indirectly) to this employee',
    );
  }
}

/** Date columns set as a side effect of a status change. */
function statusDates(status: EmployeeStatus, date: string): Record<string, string> {
  switch (status) {
    case 'probation':
      return { probation_start_date: date };
    case 'active':
      return { confirmation_date: date };
    case 'on_notice':
    case 'resigned':
      return { resignation_date: date };
    case 'terminated':
      return { termination_date: date };
    default:
      return {};
  }
}

export const employeesService = {
  async list(auth: AuthContext, query: ListEmployeesQuery) {
    const { items, meta } = await repo.list(requireTenantId(auth), query);
    return { items: items.map(toEmployeeDto), meta };
  },

  async get(auth: AuthContext, id: string) {
    const e = await repo.findById(requireTenantId(auth), id);
    if (!e) throw new NotFoundError('Employee');
    return toEmployeeDto(e);
  },

  async create(auth: AuthContext, input: CreateEmployeeBody) {
    const tenantId = requireTenantId(auth);
    await assertRefs(tenantId, input);
    const id = await guard(() =>
      withTransaction(async (trx) => {
        const data = toSnake(input);
        if (input.status === 'active' && !input.probationEndDate)
          data.confirmation_date = input.joiningDate;
        if (input.status === 'probation' && !input.probationStartDate)
          data.probation_start_date = input.joiningDate;
        const employeeId = await repo.insert(tenantId, data, trx);
        await repo.addHistory(
          tenantId,
          [
            {
              employee_id: employeeId,
              field: 'joined',
              old_value: null,
              new_value: input.status,
              effective_date: input.joiningDate,
              changed_by: auth.userId,
            },
          ],
          trx,
        );
        return employeeId;
      }),
    );
    return employeesService.get(auth, id);
  },

  async update(auth: AuthContext, id: string, input: UpdateEmployeeBody) {
    const tenantId = requireTenantId(auth);
    await guard(() =>
      withTransaction(async (trx) => {
        const current = await repo.lock(tenantId, id, trx);
        if (!current) throw new NotFoundError('Employee');
        await repo.update(tenantId, id, toSnake(input), trx);
        if (input.employmentType && input.employmentType !== current.employment_type) {
          await repo.addHistory(
            tenantId,
            [
              {
                employee_id: id,
                field: 'employment_type',
                old_value: current.employment_type ?? null,
                new_value: input.employmentType,
                effective_date: new Date().toISOString().slice(0, 10),
                changed_by: auth.userId,
              },
            ],
            trx,
          );
        }
      }),
    );
    return employeesService.get(auth, id);
  },

  /** Department transfer, designation change, branch move and/or manager change. */
  async changeAssignment(auth: AuthContext, id: string, input: AssignmentBody) {
    const tenantId = requireTenantId(auth);
    await assertRefs(tenantId, input);
    await guard(() =>
      withTransaction(async (trx) => {
        const current = await repo.lock(tenantId, id, trx);
        if (!current) throw new NotFoundError('Employee');
        if (input.managerId) await assertNoManagerLoop(tenantId, id, input.managerId, trx);

        const changes: Record<string, string | null> = {};
        const history = [];
        for (const [key, , field] of REFS) {
          if (!(key in input)) continue;
          const column = `${field}_id`;
          const next = input[key] ?? null;
          if (next === current[column]) continue;
          changes[column] = next;
          history.push({
            employee_id: id,
            field,
            old_value: current[column] ?? null,
            new_value: next,
            effective_date: input.effectiveDate,
            reason: input.reason ?? null,
            changed_by: auth.userId,
          });
        }
        if (history.length === 0) throw new BadRequestError('Nothing changed');
        await repo.update(tenantId, id, changes, trx);
        await repo.addHistory(tenantId, history, trx);
      }),
    );
    return employeesService.get(auth, id);
  },

  async changeStatus(auth: AuthContext, id: string, input: StatusBody) {
    const tenantId = requireTenantId(auth);
    await guard(() =>
      withTransaction(async (trx) => {
        const current = await repo.lock(tenantId, id, trx);
        if (!current) throw new NotFoundError('Employee');
        const from = current.status as EmployeeStatus;
        if (!STATUS_TRANSITIONS[from].includes(input.status)) {
          throw new BadRequestError(`Cannot change status from ${from} to ${input.status}`);
        }
        if (input.effectiveDate < current.joining_date!) {
          throw new BadRequestError('Effective date cannot be before the joining date');
        }
        await repo.update(
          tenantId,
          id,
          { status: input.status, ...statusDates(input.status, input.effectiveDate) },
          trx,
        );
        await repo.addHistory(
          tenantId,
          [
            {
              employee_id: id,
              field: 'status',
              old_value: from,
              new_value: input.status,
              effective_date: input.effectiveDate,
              reason: input.reason ?? null,
              changed_by: auth.userId,
            },
          ],
          trx,
        );
      }),
    );
    return employeesService.get(auth, id);
  },

  async history(auth: AuthContext, id: string) {
    const tenantId = requireTenantId(auth);
    if (!(await repo.findById(tenantId, id))) throw new NotFoundError('Employee');
    const rows = await repo.history(tenantId, id);
    return rows.map((h) => ({
      id: h.id,
      field: h.field,
      oldValue: h.old_value,
      newValue: h.new_value,
      oldLabel: h.old_label,
      newLabel: h.new_label,
      effectiveDate: h.effective_date,
      reason: h.reason,
      changedBy: h.changed_by ? { id: h.changed_by, name: h.changed_by_name } : null,
      createdAt: h.created_at,
    }));
  },

  /** Archive (soft delete). Blocked while others report to this employee. */
  async remove(auth: AuthContext, id: string) {
    const tenantId = requireTenantId(auth);
    if (await repo.hasDirectReports(tenantId, id)) {
      throw new ConflictError('Reassign this employee’s direct reports before archiving');
    }
    if (!(await repo.softDelete(tenantId, id))) throw new NotFoundError('Employee');
  },
};
