import { withTransaction } from '../../database/knex';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors/app-error';
import type { AuthContext } from '../../shared/types/auth';
import { toCamel, toSnake } from '../../shared/utils/case';
import { isForeignKeyViolation, isUniqueViolation } from '../../shared/utils/db-errors';
import type { ListQuery } from '../../shared/utils/pagination';
import { requireTenantId } from '../../shared/utils/tenant-scope';
import {
  branchesRepository,
  departmentsRepository,
  designationsRepository,
  levelsRepository,
  unitsRepository,
  type UnitRow,
} from './organization.repository';
import type { UnitBody, UnitPatch } from './organization.schema';

/** Maps DB constraint errors to API errors with a message the user can act on. */
async function guard<T>(label: string, fn: () => Promise<T>, badRef?: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isUniqueViolation(err))
      throw new ConflictError(`A ${label} with this code or name already exists`);
    if (isForeignKeyViolation(err)) {
      if (badRef) throw new BadRequestError(badRef);
      throw new ConflictError(
        `This ${label} is in use. Reassign what references it, or deactivate it instead`,
      );
    }
    throw err;
  }
}

type MasterRepo = typeof branchesRepository;

function masterService(repo: MasterRepo, label: string, resource: string, codePrefix?: string) {
  return {
    async list(auth: AuthContext, query: ListQuery & { isActive?: boolean }) {
      const { items, meta } = await repo.list(requireTenantId(auth), query);
      return { items: items.map(toCamel), meta };
    },
    async get(auth: AuthContext, id: string) {
      const row = await repo.findById(requireTenantId(auth), id);
      if (!row) throw new NotFoundError(resource);
      return toCamel(row);
    },
    async nextCode(auth: AuthContext) {
      if (!codePrefix) throw new NotFoundError('Code generator');
      return { code: await repo.nextCode(requireTenantId(auth), codePrefix) };
    },
    async create(auth: AuthContext, input: { code?: string | null }) {
      const tenantId = requireTenantId(auth);
      // ponytail: two simultaneous auto-codes can collide → 409 via unique index; user just retries.
      if (codePrefix && !input.code)
        input = { ...input, code: await repo.nextCode(tenantId, codePrefix) };
      return toCamel(await guard(label, () => repo.insert(tenantId, toSnake(input))));
    },
    async update(auth: AuthContext, id: string, input: object) {
      const tenantId = requireTenantId(auth);
      const row = await guard(label, () => repo.update(tenantId, id, toSnake(input)));
      if (!row) throw new NotFoundError(resource);
      return toCamel(row);
    },
    async remove(auth: AuthContext, id: string) {
      const tenantId = requireTenantId(auth);
      if (!(await guard(label, () => repo.delete(tenantId, id)))) throw new NotFoundError(resource);
    },
  };
}

export const branchesService = masterService(branchesRepository, 'branch', 'Branch', 'BR');
export const departmentsService = masterService(
  departmentsRepository,
  'department',
  'Department',
  'DEP',
);
export const designationsService = masterService(
  designationsRepository,
  'designation',
  'Designation',
  'DES',
);
const baseLevels = masterService(levelsRepository, 'level', 'Organization level');
export const levelsService = {
  ...baseLevels,
  /** Re-ranking a level in use could invert parent/child order, so it is blocked. */
  async update(auth: AuthContext, id: string, input: { rank?: number } & object) {
    const tenantId = requireTenantId(auth);
    if (input.rank !== undefined) {
      const current = await levelsRepository.findById(tenantId, id);
      if (!current) throw new NotFoundError('Organization level');
      if (current.rank !== input.rank && (await unitsRepository.levelInUse(tenantId, id))) {
        throw new ConflictError('This level is used by organization units; its rank cannot change');
      }
    }
    return baseLevels.update(auth, id, input);
  },
};

function toUnitDto(u: UnitRow) {
  return {
    id: u.id,
    name: u.name,
    code: u.code,
    parentId: u.parent_id,
    level: { id: u.level_id, name: u.level_name, rank: u.level_rank },
    department: u.department_id ? { id: u.department_id, name: u.department_name } : null,
    description: u.description,
    sortOrder: u.sort_order,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  };
}

export const unitsService = {
  /**
   * Builds the chart from master data: company root → one unit per active branch → one unit per
   * active department under each branch. Idempotent: units are matched by code
   * (ORG, <branch code>, <branch code>.<dept code>), so re-running only adds what is missing.
   */
  async generate(auth: AuthContext) {
    const tenantId = requireTenantId(auth);
    return withTransaction(async (trx) => {
      await unitsRepository.lockTree(tenantId, trx);
      const levels = (await trx('org_levels')
        .where({ tenant_id: tenantId })
        .orderBy('rank')
        .select('id', 'name', 'rank')) as { id: string; name: string; rank: number }[];
      const byName = (n: string) => levels.find((l) => l.name.toLowerCase() === n);
      const rootLevel = levels[0];
      const branchLevel = byName('branch') ?? levels[1];
      const deptLevel = byName('department') ?? levels.at(-1);
      if (
        !rootLevel ||
        !branchLevel ||
        !deptLevel ||
        !(rootLevel.rank < branchLevel.rank && branchLevel.rank < deptLevel.rank)
      )
        throw new BadRequestError(
          'Add at least three organization levels (e.g. Company, Branch, Department) first',
        );

      const tenant = await trx('tenants').where({ id: tenantId }).first('name');
      const branches = await trx('branches')
        .where({ tenant_id: tenantId, is_active: true })
        .orderBy('code');
      const depts = await trx('departments')
        .where({ tenant_id: tenantId, is_active: true })
        .orderBy('code');
      const existing = new Map<string, string>(
        (
          await trx('org_units')
            .where({ tenant_id: tenantId })
            .whereNotNull('code')
            .select('code', 'id')
        ).map((u: { code: string; id: string }) => [u.code, u.id]),
      );
      let created = 0;
      const ensure = async (code: string, data: Record<string, unknown>) => {
        const found = existing.get(code);
        if (found) return found;
        const id = await unitsRepository.insert(tenantId, { ...data, code }, trx);
        existing.set(code, id);
        created++;
        return id;
      };

      const root = await ensure('ORG', { name: tenant?.name ?? 'Company', level_id: rootLevel.id });
      for (const [i, b] of branches.entries()) {
        const branchId = await ensure(b.code, {
          name: b.name,
          level_id: branchLevel.id,
          parent_id: root,
          sort_order: i,
        });
        for (const [j, d] of depts.entries())
          await ensure(`${b.code}.${d.code}`.slice(0, 30), {
            name: d.name,
            level_id: deptLevel.id,
            parent_id: branchId,
            department_id: d.id,
            sort_order: j,
          });
      }
      return { created };
    });
  },

  async list(auth: AuthContext) {
    return (await unitsRepository.listAll(requireTenantId(auth))).map(toUnitDto);
  },

  async get(auth: AuthContext, id: string) {
    const unit = await unitsRepository.findById(requireTenantId(auth), id);
    if (!unit) throw new NotFoundError('Organization unit');
    return toUnitDto(unit);
  },

  async create(auth: AuthContext, input: UnitBody) {
    const tenantId = requireTenantId(auth);
    const id = await guard(
      'unit',
      () =>
        withTransaction(async (trx) => {
          await unitsRepository.lockTree(tenantId, trx);
          const rank = await unitsRepository.levelRank(tenantId, input.levelId, trx);
          if (rank === undefined) throw new BadRequestError('Unknown organization level');
          if (input.parentId) {
            const parent = await unitsRepository.findById(tenantId, input.parentId, trx);
            if (!parent) throw new BadRequestError('Unknown parent unit');
            if (parent.level_rank >= rank) {
              throw new BadRequestError(
                `A unit must sit at a lower level than its parent (${parent.level_name})`,
              );
            }
          }
          return unitsRepository.insert(tenantId, toSnake(input), trx);
        }),
      'Unknown department',
    );
    return unitsService.get(auth, id);
  },

  async update(auth: AuthContext, id: string, input: UnitPatch) {
    const tenantId = requireTenantId(auth);
    await guard(
      'unit',
      () =>
        withTransaction(async (trx) => {
          await unitsRepository.lockTree(tenantId, trx);
          const unit = await unitsRepository.findById(tenantId, id, trx);
          if (!unit) throw new NotFoundError('Organization unit');

          const levelId = input.levelId ?? unit.level_id;
          const parentId = input.parentId === undefined ? unit.parent_id : input.parentId;
          const rank = await unitsRepository.levelRank(tenantId, levelId, trx);
          if (rank === undefined) throw new BadRequestError('Unknown organization level');

          if (parentId) {
            if (await unitsRepository.isSelfOrDescendant(tenantId, id, parentId, trx)) {
              throw new BadRequestError(
                'A unit cannot be moved under itself or one of its sub-units',
              );
            }
            const parent = await unitsRepository.findById(tenantId, parentId, trx);
            if (!parent) throw new BadRequestError('Unknown parent unit');
            if (parent.level_rank >= rank) {
              throw new BadRequestError(
                `A unit must sit at a lower level than its parent (${parent.level_name})`,
              );
            }
          }
          const childMin = await unitsRepository.minChildRank(tenantId, id, trx);
          if (childMin !== null && childMin <= rank) {
            throw new BadRequestError('Sub-units must stay at a lower level than this unit');
          }
          await unitsRepository.update(tenantId, id, toSnake(input), trx);
        }),
      'Unknown department',
    );
    return unitsService.get(auth, id);
  },

  async remove(auth: AuthContext, id: string) {
    const tenantId = requireTenantId(auth);
    try {
      if (!(await unitsRepository.delete(tenantId, id)))
        throw new NotFoundError('Organization unit');
    } catch (err) {
      if (isForeignKeyViolation(err)) throw new ConflictError('Move or delete its sub-units first');
      throw err;
    }
  },
};
