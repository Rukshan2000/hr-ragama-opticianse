import { db, withTransaction, type DbExecutor } from '../../database/knex';
import type { Permission } from '../../shared/constants/permissions';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../shared/errors/app-error';
import type { AuthContext } from '../../shared/types/auth';
import { isUniqueViolation } from '../../shared/utils/db-errors';
import { requireTenantId, tenantScope } from '../../shared/utils/tenant-scope';
import { audit } from '../hr-common/audit';
import { notify, usersWithPermission } from '../notifications/notifications.service';

export type Decision = 'approved' | 'rejected';
export interface Step {
  order: number;
  type: 'manager' | 'role' | 'user';
  roleId?: string | null;
  userId?: string | null;
}

/**
 * A module plugs into the engine by registering a handler for its entity type. The engine owns
 * who may decide and the audit trail; the handler applies the business effect of the outcome
 * inside the same transaction.
 */
export interface ApprovalHandler {
  label: string;
  /** Holders of this permission may decide any step (HR override) and are the fallback approvers. */
  permission: Permission;
  link: (entityId: string) => string;
  onDecision: (
    trx: DbExecutor,
    ctx: { tenantId: string; auth: AuthContext; entityId: string; comment: string | null },
    decision: Decision | 'cancelled',
  ) => Promise<void>;
}

const handlers = new Map<string, ApprovalHandler>();
export function registerApprovalHandler(entityType: string, h: ApprovalHandler) {
  handlers.set(entityType, h);
}
export const approvalEntityTypes = () =>
  [...handlers.entries()].map(([type, h]) => ({ type, label: h.label }));
function handlerFor(entityType: string) {
  const h = handlers.get(entityType);
  if (!h) throw new BadRequestError(`No approval workflow for ${entityType}`);
  return h;
}

interface RequestRow {
  id: string;
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  title: string;
  requester_id: string | null;
  subject_employee_id: string | null;
  steps: Step[];
  current_step: number;
  status: string;
  created_at: Date;
  decided_at: Date | null;
}

const repo = {
  async definitionSteps(
    tenantId: string,
    entityType: string,
    ex: DbExecutor,
  ): Promise<Step[] | null> {
    const def = await tenantScope(ex, 'workflow_definitions', tenantId)
      .where({ entity_type: entityType, is_active: true })
      .first('id');
    if (!def) return null;
    const steps = await tenantScope(ex, 'workflow_steps', tenantId)
      .where({ definition_id: def.id })
      .orderBy('step_order')
      .select('step_order', 'approver_type', 'role_id', 'user_id');
    return steps.map((s) => ({
      order: s.step_order,
      type: s.approver_type,
      roleId: s.role_id,
      userId: s.user_id,
    }));
  },
  managerUserId(tenantId: string, employeeId: string, ex: DbExecutor) {
    return tenantScope(ex, 'employees as e', tenantId)
      .join('employees as m', 'm.id', 'e.manager_id')
      .join('tenant_memberships as tm', function () {
        this.on('tm.user_id', 'm.user_id').andOn('tm.tenant_id', 'm.tenant_id');
      })
      .where({ 'e.id': employeeId, 'tm.is_active': true })
      .whereNull('m.deleted_at')
      .first('m.user_id')
      .then((r) => (r?.user_id as string | undefined) ?? null);
  },
  roleUsers(roleId: string, ex: DbExecutor) {
    return ex('user_roles').where({ role_id: roleId }).pluck('user_id') as Promise<string[]>;
  },
  /** Users currently delegating their approvals to `userId`. */
  delegatorsOf(tenantId: string, userId: string, ex: DbExecutor = db) {
    return tenantScope(ex, 'approval_delegations', tenantId)
      .where({ to_user_id: userId })
      .where('start_date', '<=', db.raw('CURRENT_DATE'))
      .where('end_date', '>=', db.raw('CURRENT_DATE'))
      .pluck('from_user_id') as Promise<string[]>;
  },
};

/** Approvers of a step. A manager step with no reachable manager falls back to permission holders. */
async function stepApprovers(req: RequestRow, step: Step, ex: DbExecutor): Promise<string[]> {
  let users: string[] = [];
  if (step.type === 'manager' && req.subject_employee_id) {
    const m = await repo.managerUserId(req.tenant_id, req.subject_employee_id, ex);
    if (m) users = [m];
  } else if (step.type === 'role' && step.roleId) users = await repo.roleUsers(step.roleId, ex);
  else if (step.type === 'user' && step.userId) users = [step.userId];
  users = users.filter((u) => u !== req.requester_id);
  if (!users.length)
    users = (
      await usersWithPermission(req.tenant_id, handlerFor(req.entity_type).permission, ex)
    ).filter((u) => u !== req.requester_id);
  return users;
}

/** Returns the user the actor decides for (themselves or a delegator), or null if not allowed. */
async function actingFor(
  auth: AuthContext,
  req: RequestRow,
  ex: DbExecutor,
): Promise<string | null> {
  if (req.requester_id === auth.userId) return null; // nobody approves their own request
  const step = req.steps.find((s) => s.order === req.current_step)!;
  const approvers = await stepApprovers(req, step, ex);
  if (approvers.includes(auth.userId)) return auth.userId;
  if (auth.permissions.has(handlerFor(req.entity_type).permission)) return auth.userId;
  const delegators = await repo.delegatorsOf(req.tenant_id, auth.userId, ex);
  return delegators.find((d) => approvers.includes(d)) ?? null;
}

async function notifyStep(req: RequestRow, ex: DbExecutor) {
  const step = req.steps.find((s) => s.order === req.current_step)!;
  const approvers = await stepApprovers(req, step, ex);
  const delegates = approvers.length
    ? ((await tenantScope(ex, 'approval_delegations', req.tenant_id)
        .whereIn('from_user_id', approvers)
        .where('start_date', '<=', db.raw('CURRENT_DATE'))
        .where('end_date', '>=', db.raw('CURRENT_DATE'))
        .pluck('to_user_id')) as string[])
    : [];
  await notify(
    {
      tenantId: req.tenant_id,
      userIds: [...approvers, ...delegates],
      type: 'approval_pending',
      title: `Approval needed: ${req.title}`,
      body: req.steps.length > 1 ? `Step ${req.current_step} of ${req.steps.length}` : undefined,
      link: '/approvals',
      dedupeKey: `approval:${req.id}:step:${req.current_step}`,
    },
    ex,
  );
}

function toDto(r: RequestRow & { requester_name?: string; subject_name?: string }) {
  return {
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    entityLabel: handlers.get(r.entity_type)?.label ?? r.entity_type,
    link: handlers.get(r.entity_type)?.link(r.entity_id) ?? null,
    title: r.title,
    requester: r.requester_id ? { id: r.requester_id, name: r.requester_name ?? null } : null,
    subjectEmployee: r.subject_employee_id
      ? { id: r.subject_employee_id, name: r.subject_name ?? null }
      : null,
    steps: r.steps,
    currentStep: r.current_step,
    status: r.status,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
  };
}

const requestQuery = (tenantId: string) =>
  tenantScope(db, 'approval_requests as a', tenantId)
    .leftJoin('users as u', 'u.id', 'a.requester_id')
    .leftJoin('employees as e', 'e.id', 'a.subject_employee_id')
    .select(
      'a.*',
      'u.name as requester_name',
      db.raw(`e.first_name || ' ' || e.last_name as subject_name`),
    );

export const workflowService = {
  /** Starts an approval for an entity, inside the caller's transaction. */
  async submit(
    trx: DbExecutor,
    auth: AuthContext,
    input: {
      entityType: string;
      entityId: string;
      title: string;
      subjectEmployeeId: string | null;
    },
  ) {
    const tenantId = requireTenantId(auth);
    handlerFor(input.entityType);
    const steps = (await repo.definitionSteps(tenantId, input.entityType, trx)) ?? [
      { order: 1, type: 'manager' as const },
    ];
    const [row] = await trx('approval_requests')
      .insert({
        tenant_id: tenantId,
        entity_type: input.entityType,
        entity_id: input.entityId,
        title: input.title,
        requester_id: auth.userId,
        subject_employee_id: input.subjectEmployeeId,
        steps: JSON.stringify(steps),
        current_step: steps[0]!.order,
      })
      .returning<RequestRow[]>('*');
    await trx('approval_actions').insert({
      tenant_id: tenantId,
      request_id: row!.id,
      step_order: 0,
      actor_id: auth.userId,
      decision: 'submitted',
      from_status: 'new',
      to_status: 'pending',
    });
    await notifyStep(row!, trx);
    return row!.id;
  },

  /** Approve or reject the current step. Row lock + unique index make concurrent decisions safe. */
  async decide(auth: AuthContext, requestId: string, decision: Decision, comment: string | null) {
    const tenantId = requireTenantId(auth);
    if (decision === 'rejected' && !comment)
      throw new BadRequestError('A reason is required to reject');
    try {
      await withTransaction(async (trx) => {
        const req = (await tenantScope(trx, 'approval_requests', tenantId)
          .where({ id: requestId })
          .forUpdate()
          .first()) as RequestRow | undefined;
        if (!req) throw new NotFoundError('Approval request');
        if (req.status !== 'pending')
          throw new ConflictError(`This request is already ${req.status}`);
        const onBehalfOf = await actingFor(auth, req, trx);
        if (!onBehalfOf) throw new ForbiddenError('You are not an approver for this step');

        const last = req.steps.at(-1)!.order;
        const done = decision === 'rejected' || req.current_step === last;
        const toStatus = done ? decision : 'pending';
        await trx('approval_actions').insert({
          tenant_id: tenantId,
          request_id: req.id,
          step_order: req.current_step,
          actor_id: auth.userId,
          on_behalf_of: onBehalfOf === auth.userId ? null : onBehalfOf,
          decision,
          comment,
          from_status: req.status,
          to_status: toStatus,
        });
        const next = done
          ? req.current_step
          : req.steps.find((s) => s.order > req.current_step)!.order;
        await trx('approval_requests')
          .where({ id: req.id })
          .update({ status: toStatus, current_step: next, decided_at: done ? trx.fn.now() : null });
        await audit(trx, auth, `approval.${decision}`, req.entity_type, req.entity_id, {
          requestId: req.id,
          step: req.current_step,
          comment,
        });
        if (done) {
          await handlerFor(req.entity_type).onDecision(
            trx,
            { tenantId, auth, entityId: req.entity_id, comment },
            decision,
          );
          await notify(
            {
              tenantId,
              userIds: [req.requester_id],
              type: 'approval_decided',
              title: `${req.title} was ${decision}`,
              body: comment ?? undefined,
              link: handlerFor(req.entity_type).link(req.entity_id),
              dedupeKey: `approval:${req.id}:decided`,
            },
            trx,
          );
        } else await notifyStep({ ...req, current_step: next }, trx);
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictError('This step was already decided by someone else');
      throw err;
    }
    return workflowService.get(auth, requestId);
  },

  /** Requester (or the module on their behalf) withdraws a pending request. */
  async cancel(trx: DbExecutor, auth: AuthContext, entityType: string, entityId: string) {
    const tenantId = requireTenantId(auth);
    const req = (await tenantScope(trx, 'approval_requests', tenantId)
      .where({ entity_type: entityType, entity_id: entityId })
      .forUpdate()
      .first()) as RequestRow | undefined;
    if (!req || req.status !== 'pending') return;
    await trx('approval_actions').insert({
      tenant_id: tenantId,
      request_id: req.id,
      step_order: req.current_step,
      actor_id: auth.userId,
      decision: 'cancelled',
      from_status: 'pending',
      to_status: 'cancelled',
    });
    await trx('approval_requests')
      .where({ id: req.id })
      .update({ status: 'cancelled', decided_at: trx.fn.now() });
  },

  async get(auth: AuthContext, id: string) {
    const tenantId = requireTenantId(auth);
    const req = (await requestQuery(tenantId).where('a.id', id).first()) as RequestRow | undefined;
    if (!req) throw new NotFoundError('Approval request');
    const canDecide = req.status === 'pending' && Boolean(await actingFor(auth, req, db));
    const involved =
      canDecide ||
      req.requester_id === auth.userId ||
      auth.permissions.has(handlerFor(req.entity_type).permission) ||
      Boolean(
        await tenantScope(db, 'approval_actions', tenantId)
          .where({ request_id: id, actor_id: auth.userId })
          .first('id'),
      );
    if (!involved) throw new NotFoundError('Approval request');
    const actions = await tenantScope(db, 'approval_actions as aa', tenantId)
      .leftJoin('users as u', 'u.id', 'aa.actor_id')
      .leftJoin('users as d', 'd.id', 'aa.on_behalf_of')
      .where('aa.request_id', id)
      .orderBy('aa.created_at')
      .select(
        'aa.id',
        'aa.step_order as stepOrder',
        'aa.decision',
        'aa.comment',
        'aa.from_status as fromStatus',
        'aa.to_status as toStatus',
        'aa.created_at as createdAt',
        'u.name as actorName',
        'd.name as onBehalfOfName',
      );
    return { ...toDto(req), canDecide, actions };
  },

  async getForEntity(auth: AuthContext, entityType: string, entityId: string) {
    const row = await tenantScope(db, 'approval_requests', requireTenantId(auth))
      .where({ entity_type: entityType, entity_id: entityId })
      .first('id');
    return row ? workflowService.get(auth, row.id as string) : null;
  },

  /**
   * Inbox: pending requests the user can decide now ("assigned"), or ones they submitted ("mine").
   * ponytail: assigned filters pending rows in memory (cap 500); move approver resolution to SQL if
   * a tenant routinely has more open approvals than that.
   */
  async list(
    auth: AuthContext,
    q: { box: 'assigned' | 'mine' | 'all'; status?: string; entityType?: string },
  ) {
    const tenantId = requireTenantId(auth);
    const base = requestQuery(tenantId)
      .modify((b) => q.entityType && b.where('a.entity_type', q.entityType))
      .orderBy('a.created_at', 'desc')
      .limit(500);
    if (q.box === 'mine') {
      const rows = (await base
        .where('a.requester_id', auth.userId)
        .modify((b) => q.status && b.where('a.status', q.status))) as RequestRow[];
      return rows.map((r) => ({ ...toDto(r), canDecide: false }));
    }
    if (q.box === 'all') {
      const allowed = [...handlers.entries()]
        .filter(([, h]) => auth.permissions.has(h.permission))
        .map(([t]) => t);
      if (!allowed.length) return [];
      const rows = (await base
        .whereIn('a.entity_type', allowed)
        .modify((b) => q.status && b.where('a.status', q.status))) as RequestRow[];
      return Promise.all(
        rows.map(async (r) => ({
          ...toDto(r),
          canDecide: r.status === 'pending' && Boolean(await actingFor(auth, r, db)),
        })),
      );
    }
    const rows = (await base.where('a.status', 'pending')) as RequestRow[];
    const out = [];
    for (const r of rows)
      if (await actingFor(auth, r, db)) out.push({ ...toDto(r), canDecide: true });
    return out;
  },

  async pendingCount(auth: AuthContext) {
    return (await workflowService.list(auth, { box: 'assigned' })).length;
  },
};
