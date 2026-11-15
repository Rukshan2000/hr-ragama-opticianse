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
  if (snap.levels) await applyLevels(trx, tenantId, snap.levels);
  return null;
}

/**
 * Org chart levels follow the hub exactly. Names and ranks are unique, so renames and re-ranks
 * go through a parked value first; local levels the hub doesn't send are deleted, or parked
 * after the hub's levels when org units still use them.
 */
async function applyLevels(
  trx: DbExecutor,
  tenantId: string,
  levels: NonNullable<Snapshot['levels']>,
) {
  const PARK = 1_000_000;
  const ids: string[] = [];
  for (const l of levels) {
    const { id } = await link(
      trx,
      'level',
      tenantId,
      l.id,
      async () =>
        (await trx('org_levels').where({ tenant_id: tenantId, name: l.name }).first('id'))?.id,
      async () =>
        (
          await trx('org_levels')
            .insert({ tenant_id: tenantId, name: `~${l.id}`, rank: PARK + l.rank })
            .returning('id')
        )[0].id,
    );
    await trx('org_levels').where({ id }).update({ name: `~${l.id}`, rank: PARK + l.rank });
    ids.push(id);
  }
  const others = await trx('org_levels')
    .where({ tenant_id: tenantId })
    .whereNotIn('id', ids)
    .select('id', 'name', 'rank');
  for (const o of others) {
    if (!(await trx('org_units').where({ level_id: o.id }).first('id')))
      await trx('org_levels').where({ id: o.id }).delete();
    else if (o.rank < 2 * PARK)
      await trx('org_levels')
        .where({ id: o.id })
        .update({ rank: 2 * PARK + o.rank, name: `${o.name} (old)`.slice(0, 100) });
  }
  await trx('hub_links')
    .where({ entity: 'level', tenant_id: tenantId })
    .whereNotIn('local_id', ids)
    .delete();
  for (const [i, l] of levels.entries())
    await trx('org_levels').where({ id: ids[i] }).update({ name: l.name, rank: l.rank });
}

export async function applyUserCompanies(..._args: unknown[]) {
  // InvoTeam has no companies.
}
