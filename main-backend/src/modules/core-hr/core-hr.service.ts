import { db, withTransaction } from '../../database/knex';
import { PERMISSIONS as P } from '../../shared/constants/permissions';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors/app-error';
import type { AuthContext } from '../../shared/types/auth';
import { toCamel } from '../../shared/utils/case';
import { likeTerm, paginate } from '../../shared/utils/pagination';
import { requireTenantId, tenantScope } from '../../shared/utils/tenant-scope';
import { audit } from '../hr-common/audit';
import { canAccessEmployee, tenantToday } from '../hr-common/me';
import { filesService } from '../files/files.service';
import { notify, usersWithPermission } from '../notifications/notifications.service';

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/* ── Settings ─────────────────────────────────────────────── */

export const settingsService = {
  async get(auth: AuthContext) {
    const tenantId = requireTenantId(auth);
    const row = await db('tenant_settings').where({ tenant_id: tenantId }).first();
    return {
      timezone: row?.timezone ?? 'Asia/Colombo',
      currency: row?.currency ?? 'LKR',
      contractReminderDays: row?.contract_reminder_days ?? 30,
      probationReminderDays: row?.probation_reminder_days ?? 14,
    };
  },
  async update(
    auth: AuthContext,
    input: Partial<{
      timezone: string;
      currency: string;
      contractReminderDays: number;
      probationReminderDays: number;
    }>,
  ) {
    const tenantId = requireTenantId(auth);
    const data = {
      ...(input.timezone && { timezone: input.timezone }),
      ...(input.currency && { currency: input.currency }),
      ...(input.contractReminderDays !== undefined && {
        contract_reminder_days: input.contractReminderDays,
      }),
      ...(input.probationReminderDays !== undefined && {
        probation_reminder_days: input.probationReminderDays,
      }),
      updated_at: db.fn.now(),
    };
    await withTransaction(async (trx) => {
      await trx('tenant_settings')
        .insert({ tenant_id: tenantId, ...data })
        .onConflict('tenant_id')
        .merge();
      await audit(trx, auth, 'settings.update', 'tenant_settings', null, input);
    });
    return settingsService.get(auth);
  },
};

/* ── Audit log ────────────────────────────────────────────── */

export const auditService = {
  list(
    auth: AuthContext,
    q: {
      page: number;
      limit: number;
      entityType?: string;
      entityId?: string;
      search?: string;
      from?: string;
      to?: string;
    },
  ) {
    const base = tenantScope(db, 'audit_logs as a', requireTenantId(auth))
      .leftJoin('users as u', 'u.id', 'a.actor_id')
      .select(
        'a.id',
        'a.action',
        'a.entity_type as entityType',
        'a.entity_id as entityId',
        'a.data',
        'a.created_at as createdAt',
        'u.name as actorName',
        'u.email as actorEmail',
      )
      .modify((b) => {
        if (q.entityType) b.where('a.entity_type', q.entityType);
        if (q.entityId) b.where('a.entity_id', q.entityId);
        if (q.search)
          b.where((w) =>
            w
              .whereILike('a.action', likeTerm(q.search!))
              .orWhereILike('u.name', likeTerm(q.search!)),
          );
        if (q.from) b.where('a.created_at', '>=', q.from);
        if (q.to) b.whereRaw(`a.created_at < ?::date + 1`, [q.to]);
      });
    return paginate(base, q, { column: 'a.created_at', order: 'desc' });
  },
};

/* ── Onboarding / exit checklists ─────────────────────────── */

type Kind = 'onboarding' | 'exit';

export const tasksService = {
  async list(auth: AuthContext, employeeId: string, kind?: Kind) {
    if (!(await canAccessEmployee(auth, employeeId, P.EMPLOYEES_READ)))
      throw new NotFoundError('Employee');
    return tenantScope(db, 'employee_tasks as t', requireTenantId(auth))
      .leftJoin('users as u', 'u.id', 't.completed_by')
      .where('t.employee_id', employeeId)
      .modify((b) => kind && b.where('t.kind', kind))
      .orderBy([{ column: 't.kind' }, { column: 't.sort_order' }, { column: 't.created_at' }])
      .select(
        't.id',
        't.kind',
        't.title',
        't.description',
        't.due_date as dueDate',
        't.completed_at as completedAt',
        'u.name as completedByName',
      );
  },

  /** Progress board: one row per employee with open tasks of the given kind. */
  async board(auth: AuthContext, kind: Kind) {
    const rows = await tenantScope(db, 'employee_tasks as t', requireTenantId(auth))
      .join('employees as e', 'e.id', 't.employee_id')
      .leftJoin('departments as d', 'd.id', 'e.department_id')
      .whereNull('e.deleted_at')
      .where('t.kind', kind)
      .groupBy('e.id', 'd.name')
      .havingRaw(
        "count(*) FILTER (WHERE t.completed_at IS NULL) > 0 OR max(t.completed_at) > now() - interval '14 days'",
      )
      .select(
        'e.id as employeeId',
        db.raw(`e.first_name || ' ' || e.last_name as "employeeName"`),
        'e.employee_number as employeeNumber',
        'e.status',
        'e.joining_date as joiningDate',
        'd.name as departmentName',
        db.raw('count(*)::int as total'),
        db.raw('(count(*) FILTER (WHERE t.completed_at IS NOT NULL))::int as done'),
        db.raw('min(t.due_date) FILTER (WHERE t.completed_at IS NULL) as "nextDue"'),
      )
      .orderBy('nextDue');
    return rows;
  },

  /** Copies the active checklist template to the employee. Idempotent per title. */
  async generate(auth: AuthContext, employeeId: string, kind: Kind) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const e = await tenantScope(trx, 'employees', tenantId)
        .whereNull('deleted_at')
        .where({ id: employeeId })
        .forUpdate()
        .first('joining_date', 'user_id', 'first_name');
      if (!e) throw new NotFoundError('Employee');
      const templates = await tenantScope(trx, 'checklist_templates', tenantId)
        .where({ kind, is_active: true })
        .orderBy('sort_order');
      if (!templates.length)
        throw new BadRequestError(`No active ${kind} checklist items are configured`);
      const existing = new Set(
        (await tenantScope(trx, 'employee_tasks', tenantId)
          .where({ employee_id: employeeId, kind })
          .pluck('title')) as string[],
      );
      const base = kind === 'onboarding' ? e.joining_date : await tenantToday(tenantId);
      const rows = templates
        .filter((t) => !existing.has(t.title))
        .map((t) => ({
          tenant_id: tenantId,
          employee_id: employeeId,
          kind,
          title: t.title,
          description: t.description,
          due_date: addDays(base, t.due_days),
          sort_order: t.sort_order,
        }));
      if (rows.length) await trx('employee_tasks').insert(rows);
      await audit(trx, auth, `${kind}.start`, 'employees', employeeId, { tasks: rows.length });
      if (kind === 'onboarding')
        await notify(
          {
            tenantId,
            userIds: [e.user_id],
            type: 'onboarding',
            title: `Welcome aboard, ${e.first_name}!`,
            body: 'Your onboarding checklist is ready.',
            link: '/me',
            dedupeKey: `onboarding:${employeeId}`,
          },
          trx,
        );
    });
    return tasksService.list(auth, employeeId, kind);
  },

  async add(
    auth: AuthContext,
    employeeId: string,
    input: { kind: Kind; title: string; description?: string | null; dueDate?: string | null },
  ) {
    const tenantId = requireTenantId(auth);
    if (
      !(await tenantScope(db, 'employees', tenantId)
        .whereNull('deleted_at')
        .where({ id: employeeId })
        .first('id'))
    )
      throw new NotFoundError('Employee');
    const [row] = await db('employee_tasks')
      .insert({
        tenant_id: tenantId,
        employee_id: employeeId,
        kind: input.kind,
        title: input.title,
        description: input.description ?? null,
        due_date: input.dueDate ?? null,
        sort_order: 999,
      })
      .returning('*');
    return toCamel(row);
  },

  async setDone(auth: AuthContext, taskId: string, done: boolean) {
    const n = await tenantScope(db, 'employee_tasks', requireTenantId(auth))
      .where({ id: taskId })
      .update(
        done
          ? { completed_at: db.fn.now(), completed_by: auth.userId }
          : { completed_at: null, completed_by: null },
      );
    if (!n) throw new NotFoundError('Task');
  },

  async remove(auth: AuthContext, taskId: string) {
    if (
      !(await tenantScope(db, 'employee_tasks', requireTenantId(auth))
        .where({ id: taskId })
        .delete())
    )
      throw new NotFoundError('Task');
  },
};

/* ── Employment contracts ─────────────────────────────────── */

const contractQuery = (tenantId: string) =>
  tenantScope(db, 'employment_contracts as c', tenantId)
    .join('employees as e', 'e.id', 'c.employee_id')
    .leftJoin('files as f', 'f.id', 'c.file_id')
    .whereNull('e.deleted_at')
    .select(
      'c.*',
      db.raw(`e.first_name || ' ' || e.last_name as employee_name`),
      'e.employee_number',
      'e.status as employee_status',
      'f.original_name as file_name',
      db.raw(
        `CASE WHEN c.end_date IS NULL THEN NULL ELSE c.end_date - CURRENT_DATE END as days_to_expiry`,
      ),
    );

export interface ContractInput {
  employeeId: string;
  contractNumber: string;
  contractType: string;
  startDate: string;
  endDate?: string | null;
  probationEndDate?: string | null;
  fileId?: string | null;
  notes?: string | null;
}

async function contractGuard<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '23P01')
      throw new ConflictError('The employee already has an active contract for these dates');
    if (code === '23505') throw new ConflictError('This contract number is already in use');
    if (code === '23503') throw new BadRequestError('Unknown employee or file');
    if (code === '23514')
      throw new BadRequestError('The end date must be on or after the start date');
    throw err;
  }
}

export const contractsService = {
  async list(
    auth: AuthContext,
    q: {
      page: number;
      limit: number;
      search?: string;
      status?: string;
      contractType?: string;
      employeeId?: string;
      expiringWithinDays?: number;
    },
  ) {
    const base = contractQuery(requireTenantId(auth)).modify((b) => {
      if (q.status) b.where('c.status', q.status);
      if (q.contractType) b.where('c.contract_type', q.contractType);
      if (q.employeeId) b.where('c.employee_id', q.employeeId);
      if (q.expiringWithinDays !== undefined)
        b.where('c.status', 'active')
          .whereNotNull('c.end_date')
          .whereRaw('c.end_date <= CURRENT_DATE + ?::int', [q.expiringWithinDays]);
      if (q.search)
        b.where((w) =>
          w
            .whereILike('c.contract_number', likeTerm(q.search!))
            .orWhereRaw(`(e.first_name || ' ' || e.last_name) ILIKE ?`, [likeTerm(q.search!)])
            .orWhereILike('e.employee_number', likeTerm(q.search!)),
        );
    });
    const { items, meta } = await paginate<Record<string, unknown>>(base, q, {
      column: 'c.start_date',
      order: 'desc',
    });
    return { items: items.map(toCamel), meta };
  },

  async get(auth: AuthContext, id: string) {
    const row = await contractQuery(requireTenantId(auth)).where('c.id', id).first();
    if (!row) throw new NotFoundError('Contract');
    return toCamel(row);
  },

  async create(auth: AuthContext, input: ContractInput) {
    const tenantId = requireTenantId(auth);
    if (input.fileId) await filesService.assertAttachable(auth, input.fileId, 'contract');
    const id = await contractGuard(() =>
      withTransaction(async (trx) => {
        const [row] = await trx('employment_contracts')
          .insert({
            tenant_id: tenantId,
            employee_id: input.employeeId,
            contract_number: input.contractNumber,
            contract_type: input.contractType,
            start_date: input.startDate,
            end_date: input.endDate ?? null,
            probation_end_date: input.probationEndDate ?? null,
            file_id: input.fileId ?? null,
            notes: input.notes ?? null,
          })
          .returning('id');
        await audit(trx, auth, 'contract.create', 'employment_contracts', row.id, input);
        return row.id as string;
      }),
    );
    return contractsService.get(auth, id);
  },

  /** Only drafts are freely editable; active contracts change via renew/terminate. */
  async update(auth: AuthContext, id: string, input: Partial<Omit<ContractInput, 'employeeId'>>) {
    const tenantId = requireTenantId(auth);
    if (input.fileId) await filesService.assertAttachable(auth, input.fileId, 'contract');
    await contractGuard(() =>
      withTransaction(async (trx) => {
        const c = await tenantScope(trx, 'employment_contracts', tenantId)
          .where({ id })
          .forUpdate()
          .first();
        if (!c) throw new NotFoundError('Contract');
        const onlyDocs = Object.keys(input).every((k) => k === 'fileId' || k === 'notes');
        if (c.status !== 'draft' && !onlyDocs)
          throw new ConflictError(
            'Only draft contracts can be edited. Renew or terminate active contracts instead',
          );
        const data: Record<string, unknown> = {};
        const map: Record<string, string> = {
          contractNumber: 'contract_number',
          contractType: 'contract_type',
          startDate: 'start_date',
          endDate: 'end_date',
          probationEndDate: 'probation_end_date',
          fileId: 'file_id',
          notes: 'notes',
        };
        for (const [k, v] of Object.entries(input)) if (v !== undefined && map[k]) data[map[k]] = v;
        await tenantScope(trx, 'employment_contracts', tenantId).where({ id }).update(data);
        await audit(trx, auth, 'contract.update', 'employment_contracts', id, input);
      }),
    );
    return contractsService.get(auth, id);
  },

  async remove(auth: AuthContext, id: string) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const c = await tenantScope(trx, 'employment_contracts', tenantId)
        .where({ id })
        .forUpdate()
        .first();
      if (!c) throw new NotFoundError('Contract');
      if (c.status !== 'draft') throw new ConflictError('Only draft contracts can be deleted');
      await tenantScope(trx, 'employment_contracts', tenantId).where({ id }).delete();
      await audit(trx, auth, 'contract.delete', 'employment_contracts', id, null);
    });
  },

  /** draft → active; also syncs the employee's employment type (with history) and probation end. */
  async activate(auth: AuthContext, id: string) {
    const tenantId = requireTenantId(auth);
    await contractGuard(() =>
      withTransaction(async (trx) => {
        const c = await tenantScope(trx, 'employment_contracts', tenantId)
          .where({ id })
          .forUpdate()
          .first();
        if (!c) throw new NotFoundError('Contract');
        if (c.status !== 'draft') throw new ConflictError('Only draft contracts can be activated');
        await tenantScope(trx, 'employment_contracts', tenantId)
          .where({ id })
          .update({ status: 'active' });
        const e = await tenantScope(trx, 'employees', tenantId)
          .where({ id: c.employee_id })
          .forUpdate()
          .first('employment_type');
        const patch: Record<string, unknown> = { employment_type: c.contract_type };
        if (c.probation_end_date) patch.probation_end_date = c.probation_end_date;
        await tenantScope(trx, 'employees', tenantId).where({ id: c.employee_id }).update(patch);
        if (e.employment_type !== c.contract_type)
          await trx('employee_history').insert({
            tenant_id: tenantId,
            employee_id: c.employee_id,
            field: 'employment_type',
            old_value: e.employment_type,
            new_value: c.contract_type,
            effective_date: c.start_date,
            reason: `Contract ${c.contract_number}`,
            changed_by: auth.userId,
          });
        await audit(trx, auth, 'contract.activate', 'employment_contracts', id, null);
      }),
    );
    return contractsService.get(auth, id);
  },

  /** Ends the current contract the day before the new one starts and creates the renewal as active. */
  async renew(
    auth: AuthContext,
    id: string,
    input: {
      contractNumber: string;
      startDate: string;
      endDate?: string | null;
      fileId?: string | null;
      notes?: string | null;
    },
  ) {
    const tenantId = requireTenantId(auth);
    if (input.fileId) await filesService.assertAttachable(auth, input.fileId, 'contract');
    const newId = await contractGuard(() =>
      withTransaction(async (trx) => {
        const c = await tenantScope(trx, 'employment_contracts', tenantId)
          .where({ id })
          .forUpdate()
          .first();
        if (!c) throw new NotFoundError('Contract');
        if (!['active', 'expired'].includes(c.status))
          throw new ConflictError('Only active or expired contracts can be renewed');
        if (input.startDate <= c.start_date)
          throw new BadRequestError('The renewal must start after the current contract starts');
        const end =
          c.end_date && c.end_date < input.startDate ? c.end_date : addDays(input.startDate, -1);
        await tenantScope(trx, 'employment_contracts', tenantId)
          .where({ id })
          .update({ status: 'renewed', end_date: end });
        const [row] = await trx('employment_contracts')
          .insert({
            tenant_id: tenantId,
            employee_id: c.employee_id,
            contract_number: input.contractNumber,
            contract_type: c.contract_type,
            start_date: input.startDate,
            end_date: input.endDate ?? null,
            status: 'active',
            renewed_from_id: id,
            file_id: input.fileId ?? null,
            notes: input.notes ?? null,
          })
          .returning('id');
        await audit(trx, auth, 'contract.renew', 'employment_contracts', row.id, {
          from: id,
          ...input,
        });
        return row.id as string;
      }),
    );
    return contractsService.get(auth, newId);
  },

  async terminate(
    auth: AuthContext,
    id: string,
    input: { endDate: string; reason?: string | null },
  ) {
    const tenantId = requireTenantId(auth);
    await contractGuard(() =>
      withTransaction(async (trx) => {
        const c = await tenantScope(trx, 'employment_contracts', tenantId)
          .where({ id })
          .forUpdate()
          .first();
        if (!c) throw new NotFoundError('Contract');
        if (c.status !== 'active')
          throw new ConflictError('Only active contracts can be terminated');
        if (input.endDate < c.start_date)
          throw new BadRequestError('The end date cannot be before the start date');
        await tenantScope(trx, 'employment_contracts', tenantId)
          .where({ id })
          .update({ status: 'terminated', end_date: input.endDate });
        await audit(trx, auth, 'contract.terminate', 'employment_contracts', id, input);
      }),
    );
    return contractsService.get(auth, id);
  },

  /**
   * Probation confirmation: records the confirmation on the contract and moves the employee from
   * probation to active (with history), in one transaction.
   */
  async confirm(
    auth: AuthContext,
    id: string,
    input: { confirmedOn: string; reason?: string | null },
  ) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const c = await tenantScope(trx, 'employment_contracts', tenantId)
        .where({ id })
        .forUpdate()
        .first();
      if (!c) throw new NotFoundError('Contract');
      if (c.status !== 'active') throw new ConflictError('Only active contracts can be confirmed');
      if (c.confirmed_on) throw new ConflictError('This contract was already confirmed');
      const e = await tenantScope(trx, 'employees', tenantId)
        .where({ id: c.employee_id })
        .forUpdate()
        .first('status');
      if (!['probation', 'onboarding'].includes(e.status))
        throw new ConflictError(`The employee is ${e.status}, not on probation`);
      await tenantScope(trx, 'employment_contracts', tenantId)
        .where({ id })
        .update({ confirmed_on: input.confirmedOn });
      await tenantScope(trx, 'employees', tenantId)
        .where({ id: c.employee_id })
        .update({ status: 'active', confirmation_date: input.confirmedOn });
      await trx('employee_history').insert({
        tenant_id: tenantId,
        employee_id: c.employee_id,
        field: 'status',
        old_value: e.status,
        new_value: 'active',
        effective_date: input.confirmedOn,
        reason: input.reason ?? 'Probation confirmed',
        changed_by: auth.userId,
      });
      await audit(trx, auth, 'contract.confirm', 'employment_contracts', id, input);
    });
    return contractsService.get(auth, id);
  },
};

/* ── Reminders (scheduled job + on-demand) ────────────────── */

/**
 * Marks lapsed contracts expired and notifies HR about contracts ending and probations finishing
 * soon. Safe to run repeatedly: notifications are deduplicated by key.
 */
export async function runHrReminders(): Promise<void> {
  await db('employment_contracts')
    .where({ status: 'active' })
    .whereRaw('end_date < CURRENT_DATE')
    .update({ status: 'expired' });
  const tenants = await db('tenants')
    .where({ is_active: true })
    .whereNull('deleted_at')
    .select('id');
  for (const { id: tenantId } of tenants) {
    const s = await db('tenant_settings').where({ tenant_id: tenantId }).first();
    const contractDays = s?.contract_reminder_days ?? 30;
    const probationDays = s?.probation_reminder_days ?? 14;
    const contracts = await tenantScope(db, 'employment_contracts as c', tenantId)
      .join('employees as e', 'e.id', 'c.employee_id')
      .where('c.status', 'active')
      .whereNull('e.deleted_at')
      .whereRaw('c.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ?::int', [contractDays])
      .select('c.id', 'c.contract_number', 'c.end_date', 'e.first_name', 'e.last_name');
    const probations = await tenantScope(db, 'employees', tenantId)
      .whereNull('deleted_at')
      .where('status', 'probation')
      .whereRaw('probation_end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ?::int', [
        probationDays,
      ])
      .select('id', 'first_name', 'last_name', 'probation_end_date');
    if (!contracts.length && !probations.length) continue;
    const hr = await usersWithPermission(tenantId, P.CONTRACTS_MANAGE);
    for (const c of contracts)
      await notify({
        tenantId,
        userIds: hr,
        type: 'contract_expiry',
        title: `Contract ${c.contract_number} ends on ${c.end_date}`,
        body: `${c.first_name} ${c.last_name}'s contract is due for renewal.`,
        link: '/contracts',
        dedupeKey: `contract-expiry:${c.id}:${c.end_date}`,
      });
    for (const e of probations)
      await notify({
        tenantId,
        userIds: hr,
        type: 'probation_end',
        title: `Probation ends on ${e.probation_end_date}`,
        body: `${e.first_name} ${e.last_name} is due for confirmation.`,
        link: `/employees/${e.id}`,
        dedupeKey: `probation-end:${e.id}:${e.probation_end_date}`,
      });
  }
}
