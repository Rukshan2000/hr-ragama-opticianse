import type { DbExecutor } from '../../database/knex';
import { link, stale, type HubUnit, type Snapshot } from './hub-sync';

/**
 * InvoTeam: branches, departments and designations are organization-wide (no companies).
 * HR's own org chart (levels, units) stays local and edited here.
 */
export async function applyOrg(trx: DbExecutor, tenantId: string, snap: Snapshot) {
  const sync = async (
    kind: HubUnit['kind'],
    table: string,
    row: (u: HubUnit) => Record<string, unknown>,
  ) => {
    const list = snap.units.filter((u) => u.kind === kind);
    for (const u of list) {
      const data = { code: u.code, name: u.name, is_active: u.isActive, ...row(u) };
      const r = await link(
        trx,
        kind,
        tenantId,
        u.id,
        async () => (await trx(table).where({ tenant_id: tenantId, code: u.code }).first('id'))?.id,
        async () =>
          (
            await trx(table)
              .insert({ tenant_id: tenantId, ...data })
              .returning('id')
          )[0].id,
      );
      await trx(table).where({ id: r.id }).update(data);
    }
    for (const id of await stale(
      trx,
      kind,
      tenantId,
      list.map((u) => u.id),
    ))
      await trx(table).where({ id }).update({ is_active: false });
  };
  await sync('branch', 'branches', (u) => ({ address: u.address, phone: u.phone, email: u.email }));
  await sync('department', 'departments', () => ({}));
  await sync('designation', 'designations', () => ({}));
  return null;
}

export async function applyUserCompanies(..._args: unknown[]) {
  // InvoTeam has no companies.
}
