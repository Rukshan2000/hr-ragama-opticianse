import { db, withTransaction, type DbExecutor } from '../../database/knex';
import { PERMISSIONS as P } from '../../shared/constants/permissions';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors/app-error';
import type { AuthContext } from '../../shared/types/auth';
import { toCamel } from '../../shared/utils/case';
import { likeTerm, paginate } from '../../shared/utils/pagination';
import { requireTenantId, tenantScope } from '../../shared/utils/tenant-scope';
import { audit } from '../hr-common/audit';
import { findMyEmployee, requireMyEmployee, tenantToday } from '../hr-common/me';
import { notify, usersWithPermission } from '../notifications/notifications.service';
import { addDays } from '../time/attendance-calc';
import { registerApprovalHandler, workflowService } from '../workflow/workflow.service';

const userOf = async (ex: DbExecutor, tenantId: string, employeeId: string) =>
  ((await tenantScope(ex, 'employees', tenantId).where({ id: employeeId }).first('user_id'))
    ?.user_id as string | null) ?? null;

/* ── Assets ───────────────────────────────────────────────── */

export const assetsService = {
  async assign(
    auth: AuthContext,
    assetId: string,
    input: {
      employeeId: string;
      assignedOn: string;
      expectedReturnOn?: string | null;
      notes?: string | null;
    },
  ) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const a = await tenantScope(trx, 'assets', tenantId)
        .where({ id: assetId })
        .forUpdate()
        .first();
      if (!a) throw new NotFoundError('Asset');
      if (a.status !== 'available') throw new ConflictError(`This asset is ${a.status}`);
      const e = await tenantScope(trx, 'employees', tenantId)
        .whereNull('deleted_at')
        .where({ id: input.employeeId })
        .first('status', 'user_id');
      if (!e) throw new BadRequestError('Unknown employee');
      if (['resigned', 'terminated'].includes(e.status))
        throw new BadRequestError(`The employee is ${e.status}`);
      await trx('asset_assignments').insert({
        tenant_id: tenantId,
        asset_id: assetId,
        employee_id: input.employeeId,
        assigned_on: input.assignedOn,
        expected_return_on: input.expectedReturnOn ?? null,
        condition_out: a.condition,
        notes: input.notes ?? null,
        assigned_by: auth.userId,
      });
      await trx('assets').where({ id: assetId }).update({ status: 'assigned' });
      await audit(trx, auth, 'asset.assign', 'assets', assetId, input);
      await notify(
        {
          tenantId,
          userIds: [e.user_id],
          type: 'asset',
          title: `${a.name} (${a.asset_tag}) was assigned to you`,
          link: '/me?tab=assets',
          dedupeKey: `asset-assign:${assetId}:${input.assignedOn}:${input.employeeId}`,
        },
        trx,
      );
    });
  },

  async return(
    auth: AuthContext,
    assetId: string,
    input: { returnedOn: string; conditionIn: string; notes?: string | null },
  ) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const a = await tenantScope(trx, 'assets', tenantId)
        .where({ id: assetId })
        .forUpdate()
        .first();
      if (!a) throw new NotFoundError('Asset');
      const open = await tenantScope(trx, 'asset_assignments', tenantId)
        .where({ asset_id: assetId })
        .whereNull('returned_on')
        .first();
      if (!open) throw new ConflictError('This asset is not assigned');
      if (input.returnedOn < open.assigned_on)
        throw new BadRequestError('Return date is before the assignment date');
      await trx('asset_assignments')
        .where({ id: open.id })
        .update({
          returned_on: input.returnedOn,
          condition_in: input.conditionIn,
          notes: input.notes ?? open.notes,
        });
      await trx('assets')
        .where({ id: assetId })
        .update({
          status: input.conditionIn === 'damaged' ? 'maintenance' : 'available',
          condition: input.conditionIn,
        });
      await audit(trx, auth, 'asset.return', 'assets', assetId, input);
      await notify(
        {
          tenantId,
          userIds: [await userOf(trx, tenantId, open.employee_id)],
          type: 'asset',
          title: `Return of ${a.name} recorded`,
          link: '/me?tab=assets',
          dedupeKey: `asset-return:${open.id}`,
        },
        trx,
      );
    });
  },

  history(auth: AuthContext, q: { assetId?: string; employeeId?: string; open?: boolean }) {
    return tenantScope(db, 'asset_assignments as h', requireTenantId(auth))
      .join('assets as a', 'a.id', 'h.asset_id')
      .join('employees as e', 'e.id', 'h.employee_id')
      .leftJoin('users as u', 'u.id', 'h.assigned_by')
      .modify((b) => {
        if (q.assetId) b.where('h.asset_id', q.assetId);
        if (q.employeeId) b.where('h.employee_id', q.employeeId);
        if (q.open) b.whereNull('h.returned_on');
      })
      .orderBy('h.assigned_on', 'desc')
      .select(
        'h.id',
        'h.asset_id as assetId',
        'a.name as assetName',
        'a.asset_tag as assetTag',
        'h.employee_id as employeeId',
        db.raw(`e.first_name || ' ' || e.last_name as "employeeName"`),
        'h.assigned_on as assignedOn',
        'h.expected_return_on as expectedReturnOn',
        'h.returned_on as returnedOn',
        'h.condition_out as conditionOut',
        'h.condition_in as conditionIn',
        'h.notes',
        'u.name as assignedByName',
      );
  },
};

/* ── Expenses ─────────────────────────────────────────────── */

const claimQuery = (tenantId: string) =>
  tenantScope(db, 'expense_claims as c', tenantId)
    .join('employees as e', 'e.id', 'c.employee_id')
    .join('expense_categories as k', 'k.id', 'c.category_id')
    .leftJoin('files as f', 'f.id', 'c.receipt_file_id')
    .select(
      'c.*',
      db.raw(`e.first_name || ' ' || e.last_name as employee_name`),
      'e.employee_number',
      'k.name as category_name',
      'f.original_name as receipt_name',
    );

export const expensesService = {
  async list(
    auth: AuthContext,
    q: {
      page: number;
      limit: number;
      status?: string;
      employeeId?: string;
      categoryId?: string;
      from?: string;
      to?: string;
      search?: string;
      mine?: boolean;
    },
  ) {
    const tenantId = requireTenantId(auth);
    const self = q.mine || !auth.permissions.has(P.EXPENSES_READ);
    const me = self ? await requireMyEmployee(auth) : null;
    const base = claimQuery(tenantId).modify((b) => {
      if (me) b.where('c.employee_id', me.id);
      else if (q.employeeId) b.where('c.employee_id', q.employeeId);
      if (q.status) b.where('c.status', q.status);
      if (q.categoryId) b.where('c.category_id', q.categoryId);
      if (q.from) b.where('c.expense_date', '>=', q.from);
      if (q.to) b.where('c.expense_date', '<=', q.to);
      if (q.search)
        b.where((w) =>
          w
            .whereILike('c.description', likeTerm(q.search!))
            .orWhereRaw(`(e.first_name || ' ' || e.last_name) ILIKE ?`, [likeTerm(q.search!)]),
        );
    });
    const { items, meta } = await paginate<Record<string, unknown>>(base, q, {
      column: 'c.created_at',
      order: 'desc',
    });
    return { items: items.map((r) => ({ ...toCamel(r), amount: Number(r.amount) })), meta };
  },

  async create(
    auth: AuthContext,
    input: {
      employeeId?: string;
      categoryId: string;
      expenseDate: string;
      amount: number;
      description: string;
      receiptFileId?: string | null;
    },
  ) {
    const tenantId = requireTenantId(auth);
    const me = await findMyEmployee(auth);
    const employeeId = input.employeeId ?? me?.id;
    if (!employeeId) throw new BadRequestError('Choose an employee');
    if (employeeId !== me?.id && !auth.permissions.has(P.EXPENSES_MANAGE))
      throw new NotFoundError('Employee');
    if (input.expenseDate > (await tenantToday(tenantId)))
      throw new BadRequestError('The expense date cannot be in the future');
    const id = await withTransaction(async (trx) => {
      const cat = await tenantScope(trx, 'expense_categories', tenantId)
        .where({ id: input.categoryId, is_active: true })
        .first();
      if (!cat) throw new BadRequestError('Unknown or inactive category');
      if (cat.max_amount && input.amount > Number(cat.max_amount))
        throw new BadRequestError(`${cat.name} claims are limited to ${cat.max_amount}`);
      if (cat.requires_receipt && !input.receiptFileId)
        throw new BadRequestError(`${cat.name} claims need a receipt`);
      if (input.receiptFileId) {
        const f = await tenantScope(trx, 'files', tenantId)
          .where({ id: input.receiptFileId, purpose: 'receipt' })
          .first('uploaded_by', 'employee_id');
        if (!f || (f.employee_id && f.employee_id !== employeeId))
          throw new BadRequestError('Upload the receipt first');
        await trx('files').where({ id: input.receiptFileId }).update({ employee_id: employeeId });
      }
      const [row] = await trx('expense_claims')
        .insert({
          tenant_id: tenantId,
          employee_id: employeeId,
          category_id: input.categoryId,
          expense_date: input.expenseDate,
          amount: input.amount,
          description: input.description,
          receipt_file_id: input.receiptFileId ?? null,
          requested_by: auth.userId,
        })
        .returning('id');
      await workflowService.submit(trx, auth, {
        entityType: 'expense_claim',
        entityId: row.id,
        title: `${cat.name} claim: ${input.amount.toFixed(2)}`,
        subjectEmployeeId: employeeId,
      });
      return row.id as string;
    });
    return expensesService.get(auth, id);
  },

  async get(auth: AuthContext, id: string) {
    const tenantId = requireTenantId(auth);
    const c = await claimQuery(tenantId).where('c.id', id).first();
    const me = await findMyEmployee(auth);
    if (!c || (!auth.permissions.has(P.EXPENSES_READ) && c.employee_id !== me?.id))
      throw new NotFoundError('Expense claim');
    return {
      ...toCamel(c),
      amount: Number(c.amount),
      approval: await workflowService.getForEntity(auth, 'expense_claim', id).catch(() => null),
    };
  },

  async cancel(auth: AuthContext, id: string) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const c = await tenantScope(trx, 'expense_claims', tenantId)
        .where({ id })
        .forUpdate()
        .first();
      const me = await findMyEmployee(auth, trx);
      if (!c || (c.employee_id !== me?.id && !auth.permissions.has(P.EXPENSES_MANAGE)))
        throw new NotFoundError('Expense claim');
      if (c.status !== 'pending') throw new ConflictError(`This claim is ${c.status}`);
      await trx('expense_claims').where({ id }).update({ status: 'cancelled' });
      await workflowService.cancel(trx, auth, 'expense_claim', id);
    });
    return expensesService.get(auth, id);
  },

  async reimburse(
    auth: AuthContext,
    id: string,
    input: { reimbursedOn: string; paymentReference?: string | null },
  ) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const c = await tenantScope(trx, 'expense_claims', tenantId)
        .where({ id })
        .forUpdate()
        .first();
      if (!c) throw new NotFoundError('Expense claim');
      if (c.status !== 'approved')
        throw new ConflictError('Only approved claims can be reimbursed');
      await trx('expense_claims')
        .where({ id })
        .update({
          status: 'reimbursed',
          reimbursed_on: input.reimbursedOn,
          payment_reference: input.paymentReference ?? null,
        });
      await audit(trx, auth, 'expense.reimburse', 'expense_claims', id, input);
      await notify(
        {
          tenantId,
          userIds: [await userOf(trx, tenantId, c.employee_id)],
          type: 'expense',
          title: 'Your expense claim was reimbursed',
          link: '/me?tab=expenses',
          dedupeKey: `expense-paid:${id}`,
        },
        trx,
      );
    });
    return expensesService.get(auth, id);
  },
};

registerApprovalHandler('expense_claim', {
  label: 'Expense claim',
  permission: P.EXPENSES_APPROVE,
  link: () => '/expenses',
  async onDecision(trx, { tenantId, entityId }, decision) {
    await tenantScope(trx, 'expense_claims', tenantId)
      .where({ id: entityId, status: 'pending' })
      .update({ status: decision });
    if (decision === 'approved') {
      const finance = await usersWithPermission(tenantId, P.EXPENSES_MANAGE, trx);
      await notify(
        {
          tenantId,
          userIds: finance,
          type: 'expense',
          title: 'An expense claim is ready for reimbursement',
          link: '/expenses',
          dedupeKey: `expense-approved:${entityId}`,
        },
        trx,
      );
    }
  },
});

/* ── Exit management ──────────────────────────────────────── */

export const CLEARANCE_AREAS = ['Assets', 'IT access', 'Finance', 'Department', 'HR'];

const exitQuery = (tenantId: string) =>
  tenantScope(db, 'exit_cases as x', tenantId)
    .join('employees as e', 'e.id', 'x.employee_id')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .select(
      'x.*',
      db.raw(`e.first_name || ' ' || e.last_name as employee_name`),
      'e.employee_number',
      'e.status as employee_status',
      'd.name as department_name',
    );

const exitDto = (r: Record<string, unknown>) => ({
  ...toCamel(r),
  settlementEarnings: r.settlement_earnings === null ? null : Number(r.settlement_earnings),
  settlementDeductions: r.settlement_deductions === null ? null : Number(r.settlement_deductions),
  settlementNet: r.settlement_net === null ? null : Number(r.settlement_net),
});

export const exitService = {
  async list(auth: AuthContext, q: { status?: string; exitType?: string; search?: string }) {
    const rows = await exitQuery(requireTenantId(auth))
      .modify((b) => {
        if (q.status) b.where('x.status', q.status);
        if (q.exitType) b.where('x.exit_type', q.exitType);
        if (q.search)
          b.whereRaw(`(e.first_name || ' ' || e.last_name) ILIKE ?`, [likeTerm(q.search)]);
      })
      .orderBy('x.created_at', 'desc')
      .limit(500);
    return rows.map(exitDto);
  },

  async get(auth: AuthContext, id: string) {
    const tenantId = requireTenantId(auth);
    const x = await exitQuery(tenantId).where('x.id', id).first();
    const me = await findMyEmployee(auth);
    if (!x || (!auth.permissions.has(P.EXIT_READ) && x.employee_id !== me?.id))
      throw new NotFoundError('Exit case');
    const [clearances, openAssets] = await Promise.all([
      tenantScope(db, 'exit_clearances as c', tenantId)
        .leftJoin('users as u', 'u.id', 'c.cleared_by')
        .where('c.exit_case_id', id)
        .orderBy('c.created_at')
        .select(
          'c.id',
          'c.area',
          'c.is_cleared as isCleared',
          'c.notes',
          'c.cleared_at as clearedAt',
          'u.name as clearedByName',
        ),
      assetsService.history(auth, { employeeId: x.employee_id, open: true }),
    ]);
    return {
      ...exitDto(x),
      clearances,
      openAssets,
      approval: await workflowService.getForEntity(auth, 'exit_case', id).catch(() => null),
    };
  },

  async mine(auth: AuthContext) {
    const me = await findMyEmployee(auth);
    if (!me) return null;
    const x = await exitQuery(requireTenantId(auth))
      .where('x.employee_id', me.id)
      .orderBy('x.created_at', 'desc')
      .first();
    return x ? exitDto(x) : null;
  },

  /** Resignation by the employee, or resignation/termination recorded by HR. Goes through approval. */
  async create(
    auth: AuthContext,
    input: {
      employeeId?: string;
      exitType: 'resignation' | 'termination';
      noticeDate: string;
      noticeDays: number;
      lastWorkingDay?: string | null;
      reason?: string | null;
    },
  ) {
    const tenantId = requireTenantId(auth);
    const me = await findMyEmployee(auth);
    const isHr = auth.permissions.has(P.EXIT_MANAGE);
    const employeeId = input.employeeId ?? me?.id;
    if (!employeeId) throw new BadRequestError('Choose an employee');
    if (!isHr && (employeeId !== me?.id || input.exitType !== 'resignation'))
      throw new NotFoundError('Employee');
    const last = input.lastWorkingDay ?? addDays(input.noticeDate, input.noticeDays);
    if (last < input.noticeDate)
      throw new BadRequestError('The last working day cannot be before the notice date');
    const id = await withTransaction(async (trx) => {
      const e = await tenantScope(trx, 'employees', tenantId)
        .whereNull('deleted_at')
        .where({ id: employeeId })
        .forUpdate()
        .first('status', 'first_name', 'last_name');
      if (!e) throw new NotFoundError('Employee');
      if (['resigned', 'terminated', 'inactive'].includes(e.status))
        throw new ConflictError(`The employee is already ${e.status}`);
      const open = await tenantScope(trx, 'exit_cases', tenantId)
        .where({ employee_id: employeeId })
        .whereIn('status', ['pending', 'approved'])
        .first('id');
      if (open) throw new ConflictError('An exit case is already open for this employee');
      const [row] = await trx('exit_cases')
        .insert({
          tenant_id: tenantId,
          employee_id: employeeId,
          exit_type: input.exitType,
          notice_date: input.noticeDate,
          notice_days: input.noticeDays,
          last_working_day: last,
          reason: input.reason ?? null,
          requested_by: auth.userId,
        })
        .returning('id');
      await workflowService.submit(trx, auth, {
        entityType: 'exit_case',
        entityId: row.id,
        title: `${input.exitType === 'resignation' ? 'Resignation' : 'Termination'}: ${e.first_name} ${e.last_name} (last day ${last})`,
        subjectEmployeeId: employeeId,
      });
      return row.id as string;
    });
    return exitService.get(auth, id);
  },

  async withdraw(auth: AuthContext, id: string) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const x = await tenantScope(trx, 'exit_cases', tenantId).where({ id }).forUpdate().first();
      const me = await findMyEmployee(auth, trx);
      if (!x || (x.employee_id !== me?.id && !auth.permissions.has(P.EXIT_MANAGE)))
        throw new NotFoundError('Exit case');
      if (x.status !== 'pending')
        throw new ConflictError('Only pending exit requests can be withdrawn');
      await trx('exit_cases').where({ id }).update({ status: 'cancelled' });
      await workflowService.cancel(trx, auth, 'exit_case', id);
    });
    return exitService.get(auth, id);
  },

  async update(auth: AuthContext, id: string, input: Record<string, unknown>) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const x = await tenantScope(trx, 'exit_cases', tenantId).where({ id }).forUpdate().first();
      if (!x) throw new NotFoundError('Exit case');
      if (['completed', 'cancelled', 'rejected'].includes(x.status))
        throw new ConflictError(`This exit case is ${x.status}`);
      const data: Record<string, unknown> = {};
      const map: Record<string, string> = {
        lastWorkingDay: 'last_working_day',
        interviewDate: 'interview_date',
        interviewNotes: 'interview_notes',
        settlementEarnings: 'settlement_earnings',
        settlementDeductions: 'settlement_deductions',
        settlementPaidOn: 'settlement_paid_on',
        settlementNotes: 'settlement_notes',
      };
      for (const [k, v] of Object.entries(input)) if (v !== undefined && map[k]) data[map[k]] = v;
      const earn = Number(data.settlement_earnings ?? x.settlement_earnings ?? 0);
      const ded = Number(data.settlement_deductions ?? x.settlement_deductions ?? 0);
      if ('settlement_earnings' in data || 'settlement_deductions' in data)
        data.settlement_net = (earn - ded).toFixed(2);
      await trx('exit_cases').where({ id }).update(data);
      if (data.last_working_day && x.status === 'approved')
        await tenantScope(trx, 'employees', tenantId)
          .where({ id: x.employee_id })
          .update({
            [x.exit_type === 'resignation' ? 'resignation_date' : 'termination_date']:
              data.last_working_day,
          });
      await audit(trx, auth, 'exit.update', 'exit_cases', id, input);
    });
    return exitService.get(auth, id);
  },

  async clear(
    auth: AuthContext,
    id: string,
    clearanceId: string,
    input: { isCleared: boolean; notes?: string | null },
  ) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const c = await tenantScope(trx, 'exit_clearances', tenantId)
        .where({ id: clearanceId, exit_case_id: id })
        .forUpdate()
        .first();
      if (!c) throw new NotFoundError('Clearance');
      if (input.isCleared && c.area === 'Assets') {
        const x = await tenantScope(trx, 'exit_cases', tenantId).where({ id }).first('employee_id');
        const open = await tenantScope(trx, 'asset_assignments', tenantId)
          .where({ employee_id: x.employee_id })
          .whereNull('returned_on')
          .first('id');
        if (open)
          throw new ConflictError(
            'The employee still holds company assets. Record their return first',
          );
      }
      await trx('exit_clearances')
        .where({ id: clearanceId })
        .update({
          is_cleared: input.isCleared,
          notes: input.notes ?? c.notes,
          cleared_by: input.isCleared ? auth.userId : null,
          cleared_at: input.isCleared ? trx.fn.now() : null,
        });
      await audit(trx, auth, 'exit.clearance', 'exit_cases', id, { area: c.area, ...input });
    });
    return exitService.get(auth, id);
  },

  /** Final step: every clearance done → employee becomes resigned/terminated (with history). */
  async complete(auth: AuthContext, id: string) {
    const tenantId = requireTenantId(auth);
    await withTransaction(async (trx) => {
      const x = await tenantScope(trx, 'exit_cases', tenantId).where({ id }).forUpdate().first();
      if (!x) throw new NotFoundError('Exit case');
      if (x.status !== 'approved')
        throw new ConflictError('Only approved exit cases can be completed');
      const pending = await tenantScope(trx, 'exit_clearances', tenantId)
        .where({ exit_case_id: id, is_cleared: false })
        .pluck('area');
      if (pending.length)
        throw new ConflictError(`Clearance is pending for: ${pending.join(', ')}`);
      const e = await tenantScope(trx, 'employees', tenantId)
        .where({ id: x.employee_id })
        .forUpdate()
        .first('status');
      const final = x.exit_type === 'resignation' ? 'resigned' : 'terminated';
      await tenantScope(trx, 'employees', tenantId)
        .where({ id: x.employee_id })
        .update({
          status: final,
          [final === 'resigned' ? 'resignation_date' : 'termination_date']: x.last_working_day,
        });
      await trx('employee_history').insert({
        tenant_id: tenantId,
        employee_id: x.employee_id,
        field: 'status',
        old_value: e.status,
        new_value: final,
        effective_date: x.last_working_day,
        reason: 'Exit completed',
        changed_by: auth.userId,
      });
      await trx('exit_cases').where({ id }).update({ status: 'completed' });
      await audit(trx, auth, 'exit.complete', 'exit_cases', id, null);
    });
    return exitService.get(auth, id);
  },
};

registerApprovalHandler('exit_case', {
  label: 'Resignation / termination',
  permission: P.EXIT_MANAGE,
  link: (id) => `/exit?case=${id}`,
  async onDecision(trx, { tenantId, entityId, auth }, decision) {
    const x = await tenantScope(trx, 'exit_cases', tenantId)
      .where({ id: entityId })
      .forUpdate()
      .first();
    if (x.status !== 'pending') return;
    await trx('exit_cases').where({ id: entityId }).update({ status: decision });
    if (decision !== 'approved') return;
    const e = await tenantScope(trx, 'employees', tenantId)
      .where({ id: x.employee_id })
      .forUpdate()
      .first('status');
    // Serving notice; the final status is set when the exit is completed.
    const dateCol = x.exit_type === 'resignation' ? 'resignation_date' : 'termination_date';
    await tenantScope(trx, 'employees', tenantId)
      .where({ id: x.employee_id })
      .update({ status: 'on_notice', [dateCol]: x.last_working_day });
    if (e.status !== 'on_notice')
      await trx('employee_history').insert({
        tenant_id: tenantId,
        employee_id: x.employee_id,
        field: 'status',
        old_value: e.status,
        new_value: 'on_notice',
        effective_date: x.notice_date,
        reason: `${x.exit_type} approved`,
        changed_by: auth.userId,
      });
    await trx('exit_clearances')
      .insert(
        CLEARANCE_AREAS.map((area) => ({ tenant_id: tenantId, exit_case_id: entityId, area })),
      )
      .onConflict(['exit_case_id', 'area'])
      .ignore();
    // Exit checklist from templates, if configured.
    const templates = await tenantScope(trx, 'checklist_templates', tenantId).where({
      kind: 'exit',
      is_active: true,
    });
    if (templates.length)
      await trx('employee_tasks').insert(
        templates.map((t) => ({
          tenant_id: tenantId,
          employee_id: x.employee_id,
          kind: 'exit',
          title: t.title,
          description: t.description,
          due_date: addDays(x.last_working_day, t.due_days),
          sort_order: t.sort_order,
        })),
      );
    const hr = await usersWithPermission(tenantId, P.EXIT_MANAGE, trx);
    await notify(
      {
        tenantId,
        userIds: hr,
        type: 'exit',
        title: 'Exit approved: clearance can start',
        link: `/exit?case=${entityId}`,
        dedupeKey: `exit-approved:${entityId}`,
      },
      trx,
    );
  },
});
