import type { DbExecutor } from '../../database/knex';
import type { AuthContext } from '../../shared/types/auth';
import { requireTenantId } from '../../shared/utils/tenant-scope';

/** Appends to the tenant audit log inside the caller's transaction (atomic with the change). */
export async function audit(
  trx: DbExecutor,
  auth: AuthContext,
  action: string,
  entityType: string,
  entityId: string | null,
  data: unknown,
): Promise<void> {
  await trx('audit_logs').insert({
    tenant_id: requireTenantId(auth),
    actor_id: auth.userId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    data: data === null || data === undefined ? null : JSON.stringify(data),
  });
}
