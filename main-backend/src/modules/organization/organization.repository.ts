import { db, type DbExecutor } from '../../database/knex';
import { likeTerm, paginate, type ListQuery } from '../../shared/utils/pagination';
import { tenantScope } from '../../shared/utils/tenant-scope';

export type MasterTable = 'branches' | 'departments' | 'designations' | 'org_levels';
type Row = Record<string, unknown> & { id: string };

const SORT: Record<string, string> = {
  name: 'name',
  code: 'code',
  rank: 'rank',
  createdAt: 'created_at',
};

/** Same CRUD shape for every flat master-data table; the table name is never client input. */
function master(table: MasterTable, searchCols: string[]) {
  return {
    list(tenantId: string, query: ListQuery & { isActive?: boolean }) {
      const base = tenantScope(db, table, tenantId)
        .select('*')
        .modify((q) => {
          if (query.search) {
            const term = likeTerm(query.search);
            q.where((w) => searchCols.forEach((c) => w.orWhereILike(c, term)));
          }
          if (query.isActive !== undefined) q.where('is_active', query.isActive);
        });
      return paginate<Row>(base, query, { column: SORT[query.sort]!, order: query.order });
    },

    findById(tenantId: string, id: string, executor: DbExecutor = db): Promise<Row | undefined> {
      return tenantScope(executor, table, tenantId).where({ id }).first();
    },

    async insert(tenantId: string, data: Record<string, unknown>): Promise<Row> {
      const [row] = await db(table)
        .insert({ ...data, tenant_id: tenantId })
        .returning<Row[]>('*');
      return row!;
    },

    async update(tenantId: string, id: string, data: Record<string, unknown>) {
      const [row] = await tenantScope(db, table, tenantId)
        .where({ id })
        .update(data)
        .returning<Row[]>('*');
      return row;
    },

    async delete(tenantId: string, id: string): Promise<boolean> {
      return (await tenantScope(db, table, tenantId).where({ id }).delete()) > 0;
    },
  };
}

export const branchesRepository = master('branches', ['name', 'code']);
export const departmentsRepository = master('departments', ['name', 'code']);
export const designationsRepository = master('designations', ['name', 'code']);
export const levelsRepository = master('org_levels', ['name']);

export interface UnitRow {
  id: string;
  name: string;
  code: string | null;
  parent_id: string | null;
  level_id: string;
  level_name: string;
  level_rank: number;
  department_id: string | null;
  department_name: string | null;
  description: string | null;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

function unitsQuery(executor: DbExecutor, tenantId: string) {
  return tenantScope(executor, 'org_units as u', tenantId)
    .join('org_levels as l', 'l.id', 'u.level_id')
    .leftJoin('departments as d', 'd.id', 'u.department_id')
    .select(
      'u.id',
      'u.name',
      'u.code',
      'u.parent_id',
      'u.level_id',
      'l.name as level_name',
      'l.rank as level_rank',
      'u.department_id',
      'd.name as department_name',
      'u.description',
      'u.sort_order',
      'u.created_at',
      'u.updated_at',
    );
}

export const unitsRepository = {
  /** Serialises structural edits per tenant so concurrent moves cannot form a cycle. */
  async lockTree(tenantId: string, trx: DbExecutor) {
    await trx.raw(`SELECT pg_advisory_xact_lock(hashtext('org_units:' || ?))`, [tenantId]);
  },

  /** Whole chart in one query; org charts are hundreds of nodes, not millions. */
  listAll(tenantId: string): Promise<UnitRow[]> {
    return unitsQuery(db, tenantId).orderBy([{ column: 'u.sort_order' }, { column: 'u.name' }]);
  },

  findById(tenantId: string, id: string, executor: DbExecutor = db): Promise<UnitRow | undefined> {
    return unitsQuery(executor, tenantId).where('u.id', id).first();
  },

  async levelRank(tenantId: string, levelId: string, executor: DbExecutor = db) {
    const row = await tenantScope(executor, 'org_levels', tenantId)
      .where({ id: levelId })
      .first('rank');
    return row?.rank as number | undefined;
  },

  /** True if `candidateId` is `unitId` itself or one of its descendants (would create a cycle). */
  async isSelfOrDescendant(
    tenantId: string,
    unitId: string,
    candidateId: string,
    executor: DbExecutor = db,
  ) {
    const { rows } = await executor.raw<{ rows: unknown[] }>(
      `WITH RECURSIVE sub AS (
         SELECT id FROM org_units WHERE tenant_id = ? AND id = ?
         UNION ALL
         SELECT u.id FROM org_units u JOIN sub ON u.parent_id = sub.id WHERE u.tenant_id = ?
       ) SELECT 1 FROM sub WHERE id = ? LIMIT 1`,
      [tenantId, unitId, tenantId, candidateId],
    );
    return rows.length > 0;
  },

  /** Smallest level rank among the unit's direct children (children must stay deeper). */
  async minChildRank(tenantId: string, unitId: string, executor: DbExecutor = db) {
    const row = await tenantScope(executor, 'org_units as u', tenantId)
      .join('org_levels as l', 'l.id', 'u.level_id')
      .where('u.parent_id', unitId)
      .min<{ min: number | null }>('l.rank as min')
      .first();
    return row?.min ?? null;
  },

  async levelInUse(tenantId: string, levelId: string) {
    return Boolean(
      await tenantScope(db, 'org_units', tenantId).where({ level_id: levelId }).first('id'),
    );
  },

  async insert(tenantId: string, data: Record<string, unknown>, executor: DbExecutor) {
    const [row] = await executor('org_units')
      .insert({ ...data, tenant_id: tenantId })
      .returning<{ id: string }[]>('id');
    return row!.id;
  },

  async update(tenantId: string, id: string, data: Record<string, unknown>, executor: DbExecutor) {
    await tenantScope(executor, 'org_units', tenantId).where({ id }).update(data);
  },

  async delete(tenantId: string, id: string) {
    return (await tenantScope(db, 'org_units', tenantId).where({ id }).delete()) > 0;
  },
};
