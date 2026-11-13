import type { DbExecutor } from '../../database/knex';
import { ForbiddenError } from '../errors/app-error';
import type { AuthContext } from '../types/auth';

/**
 * Starting point for every query on a tenant-owned table. Repositories must build
 * tenant data queries from this so the tenant filter can never be forgotten.
 */
export function tenantScope(executor: DbExecutor, table: string, tenantId: string) {
  const alias = table.split(/\s+as\s+/i)[1] ?? table; // supports 'roles as r'
  return executor(table).where(`${alias}.tenant_id`, tenantId);
}

/** Tenant id from the authenticated context only; client-supplied tenant ids are never used. */
export function requireTenantId(auth: AuthContext | undefined): string {
  if (!auth?.tenantId) throw new ForbiddenError('This action requires a tenant context');
  return auth.tenantId;
}
