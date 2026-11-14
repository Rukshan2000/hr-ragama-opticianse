import type { DbExecutor } from '../../database/knex';
import { tenantScope } from './tenant-scope';

/** Next "<PREFIX>-NNN" code after the highest existing one for this tenant. */
export async function nextCode(
  executor: DbExecutor,
  table: string,
  tenantId: string,
  prefix: string,
): Promise<string> {
  const row = await tenantScope(executor, table, tenantId)
    .whereRaw('code ~ ?', [`^${prefix}-[0-9]+$`])
    .max({ n: executor.raw("substring(code from '[0-9]+$')::int") })
    .first<{ n: number | null }>();
  return `${prefix}-${String((row?.n ?? 0) + 1).padStart(3, '0')}`;
}
