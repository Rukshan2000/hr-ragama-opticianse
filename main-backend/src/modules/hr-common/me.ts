import { db, type DbExecutor } from '../../database/knex';
import { ForbiddenError } from '../../shared/errors/app-error';
import type { AuthContext } from '../../shared/types/auth';
import { requireTenantId, tenantScope } from '../../shared/utils/tenant-scope';

export interface MyEmployee {
  id: string;
  manager_id: string | null;
  branch_id: string | null;
  department_id: string | null;
  employment_type: string;
  status: string;
}

/** The employee record linked to the signed-in user in this tenant, if any. */
export function findMyEmployee(auth: AuthContext, ex: DbExecutor = db) {
  return tenantScope(ex, 'employees', requireTenantId(auth))
    .whereNull('deleted_at')
    .where({ user_id: auth.userId })
    .first<MyEmployee | undefined>(
      'id',
      'manager_id',
      'branch_id',
      'department_id',
      'employment_type',
      'status',
    );
}

export async function requireMyEmployee(auth: AuthContext, ex: DbExecutor = db) {
  const me = await findMyEmployee(auth, ex);
  if (!me) throw new ForbiddenError('Your account is not linked to an employee record');
  return me;
}

/**
 * Row-level access: users with `permission` see everyone; otherwise only their own record,
 * or — for managers — their direct reports.
 */
export async function canAccessEmployee(
  auth: AuthContext,
  employeeId: string,
  permission: string,
  { allowManager = true } = {},
): Promise<boolean> {
  // Existence is always checked in the caller's tenant, so a permission never reaches other tenants.
  const exists = await tenantScope(db, 'employees', requireTenantId(auth))
    .whereNull('deleted_at')
    .where({ id: employeeId })
    .first('id');
  if (!exists) return false;
  if (auth.permissions.has(permission as never)) return true;
  const me = await findMyEmployee(auth);
  if (!me) return false;
  if (me.id === employeeId) return true;
  if (!allowManager) return false;
  const e = await tenantScope(db, 'employees', requireTenantId(auth))
    .where({ id: employeeId, manager_id: me.id })
    .first('id');
  return Boolean(e);
}

/** Today in the tenant's configured time zone (YYYY-MM-DD). */
export async function tenantToday(tenantId: string): Promise<string> {
  const tz = await tenantTimezone(tenantId);
  return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}

export async function tenantTimezone(tenantId: string): Promise<string> {
  const s = await db('tenant_settings').where({ tenant_id: tenantId }).first('timezone');
  return (s?.timezone as string | undefined) ?? 'Asia/Colombo';
}
