import { db, withTransaction } from '../../database/knex';
import { PERMISSIONS as P } from '../../shared/constants/permissions';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors/app-error';
import type { AuthContext } from '../../shared/types/auth';
import { toCamel } from '../../shared/utils/case';
import { isUniqueViolation } from '../../shared/utils/db-errors';
import { requireTenantId, tenantScope } from '../../shared/utils/tenant-scope';
import { employeesService } from '../employees/employees.service';
import { audit } from '../hr-common/audit';
import { findMyEmployee, requireMyEmployee, tenantToday } from '../hr-common/me';
import { registerApprovalHandler, workflowService } from '../workflow/workflow.service';

/** Fields an employee may change directly; everything else in SENSITIVE needs HR approval. */
export const DIRECT_FIELDS = [
  'phone',
  'address',
  'emergencyContactName',
  'emergencyContactPhone',
  'emergencyContactRelationship',
] as const;
export const SENSITIVE_FIELDS = [
  'firstName',
  'lastName',
  'displayName',
  'email',
  'dateOfBirth',
  'gender',
] as const;
const COLUMN: Record<string, string> = {
  phone: 'phone',
  address: 'address',
  emergencyContactName: 'emergency_contact_name',
  emergencyContactPhone: 'emergency_contact_phone',
  emergencyContactRelationship: 'emergency_contact_relationship',
  firstName: 'first_name',
  lastName: 'last_name',
  displayName: 'display_name',
  email: 'email',
  dateOfBirth: 'date_of_birth',
  gender: 'gender',
};

export const portalService = {
  async profile(auth: AuthContext) {
    const me = await findMyEmployee(auth);
    if (!me) return null;
    const tenantId = requireTenantId(auth);
    const [employee, pending, photo] = await Promise.all([
      employeesService.get(auth, me.id),
      tenantScope(db, 'profile_change_requests', tenantId)
        .where({ employee_id: me.id })
        .orderBy('created_at', 'desc')
        .limit(10),
      tenantScope(db, 'employees', tenantId).where({ id: me.id }).first('photo_file_id'),
    ]);
    return {
      employee: { ...employee, photoFileId: photo?.photo_file_id ?? null },
      changeRequests: pending.map(toCamel),
    };
  },

  /** Direct fields are saved now; sensitive fields become one change request for HR approval. */
  async updateProfile(
    auth: AuthContext,
    input: Record<string, string | null | undefined>,
    reason: string | null,
  ) {
    const tenantId = requireTenantId(auth);
    const me = await requireMyEmployee(auth);
    const direct = Object.fromEntries(
      DIRECT_FIELDS.filter((f) => input[f] !== undefined).map((f) => [COLUMN[f], input[f]]),
    );
    const sensitive = Object.fromEntries(
      SENSITIVE_FIELDS.filter((f) => input[f] !== undefined).map((f) => [f, input[f]]),
    );
    let requested = false;
    await withTransaction(async (trx) => {
      if (Object.keys(direct).length) {
        await tenantScope(trx, 'employees', tenantId).where({ id: me.id }).update(direct);
        await audit(trx, auth, 'profile.update', 'employees', me.id, direct);
      }
      if (Object.keys(sensitive).length) {
        const open = await tenantScope(trx, 'profile_change_requests', tenantId)
          .where({ employee_id: me.id, status: 'pending' })
          .first('id');
        if (open) throw new ConflictError('You already have a pending change request');
        const [row] = await trx('profile_change_requests')
          .insert({
            tenant_id: tenantId,
            employee_id: me.id,
            changes: JSON.stringify(sensitive),
            reason,
          })
          .returning('id');
        await workflowService.submit(trx, auth, {
          entityType: 'profile_change',
          entityId: row.id,
          title: `Profile change: ${Object.keys(sensitive).join(', ')}`,
          subjectEmployeeId: me.id,
        });
        requested = true;
      }
    });
    return { ...(await portalService.profile(auth)), approvalRequested: requested };
  },

  /** One-glance self-service summary. */
  async overview(auth: AuthContext) {
    const me = await findMyEmployee(auth);
    if (!me) return null;
    const tenantId = requireTenantId(auth);
    const today = await tenantToday(tenantId);
    const [pendingLeave, openTasks, assets, reviews] = await Promise.all([
      tenantScope(db, 'leave_requests', tenantId)
        .where({ employee_id: me.id, status: 'pending' })
        .count<{ c: string }[]>({ c: '*' })
        .first(),
      tenantScope(db, 'employee_tasks', tenantId)
        .where({ employee_id: me.id })
        .whereNull('completed_at')
        .orderBy('due_date')
        .select('id', 'kind', 'title', 'due_date as dueDate'),
      tenantScope(db, 'asset_assignments as h', tenantId)
        .join('assets as a', 'a.id', 'h.asset_id')
        .where('h.employee_id', me.id)
        .whereNull('h.returned_on')
        .select('a.name', 'a.asset_tag as assetTag', 'h.assigned_on as assignedOn'),
      tenantScope(db, 'performance_reviews as r', tenantId)
        .join('performance_cycles as c', 'c.id', 'r.cycle_id')
        .where((w) => w.where('r.employee_id', me.id).orWhere('r.reviewer_id', me.id))
        .whereNot('r.status', 'completed')
        .select('r.id', 'r.status', 'r.employee_id as employeeId', 'c.name as cycleName'),
    ]);
    return {
      employeeId: me.id,
      today,
      pendingLeave: Number(pendingLeave?.c ?? 0),
      openTasks,
      assets,
      reviews,
    };
  },

  /** Links / unlinks a login account (employees:manage). One employee per user per tenant. */
  async linkAccount(auth: AuthContext, employeeId: string, userId: string | null) {
    const tenantId = requireTenantId(auth);
    try {
      await withTransaction(async (trx) => {
        if (
          userId &&
          !(await trx('tenant_memberships')
            .where({ tenant_id: tenantId, user_id: userId })
            .first('id'))
        )
          throw new BadRequestError('The user is not a member of this organization');
        const n = await tenantScope(trx, 'employees', tenantId)
          .whereNull('deleted_at')
          .where({ id: employeeId })
          .update({ user_id: userId });
        if (!n) throw new NotFoundError('Employee');
        await audit(
          trx,
          auth,
          userId ? 'employee.link_account' : 'employee.unlink_account',
          'employees',
          employeeId,
          { userId },
        );
      });
    } catch (e) {
      if (isUniqueViolation(e))
        throw new ConflictError('This account is already linked to another employee');
      throw e;
    }
    return employeesService.get(auth, employeeId);
  },

  async linkedUser(auth: AuthContext, employeeId: string) {
    const r = await tenantScope(db, 'employees as e', requireTenantId(auth))
      .leftJoin('users as u', 'u.id', 'e.user_id')
      .where('e.id', employeeId)
      .first('u.id', 'u.name', 'u.email');
    return r?.id ? r : null;
  },
};

registerApprovalHandler('profile_change', {
  label: 'Profile change',
  permission: P.EMPLOYEES_UPDATE,
  link: () => '/me',
  async onDecision(trx, { tenantId, entityId, auth }, decision) {
    const r = await tenantScope(trx, 'profile_change_requests', tenantId)
      .where({ id: entityId })
      .forUpdate()
      .first();
    if (r.status !== 'pending') return;
    await trx('profile_change_requests').where({ id: entityId }).update({ status: decision });
    if (decision !== 'approved') return;
    const data = Object.fromEntries(
      Object.entries(r.changes as Record<string, unknown>).map(([k, v]) => [
        COLUMN[k],
        v === '' ? null : v,
      ]),
    );
    try {
      await tenantScope(trx, 'employees', tenantId).where({ id: r.employee_id }).update(data);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError('Another employee already uses this email');
      throw e;
    }
    await audit(trx, auth, 'profile.change_approved', 'employees', r.employee_id, r.changes);
  },
});
