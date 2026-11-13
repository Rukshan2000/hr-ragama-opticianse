import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db, withTransaction } from '../../database/knex';
import { PERMISSIONS as P } from '../../shared/constants/permissions';
import { BadRequestError, NotFoundError } from '../../shared/errors/app-error';
import type { AuthContext } from '../../shared/types/auth';
import { sendSuccess } from '../../shared/utils/response';
import { requireTenantId, tenantScope } from '../../shared/utils/tenant-scope';
import { authenticate, requirePermissions } from '../auth/auth.guard';
import { audit } from '../hr-common/audit';
import { dbGuard, idParams, isoDate, text } from '../hr-common/crud';
import { approvalEntityTypes, workflowService as s } from './workflow.service';

const tags = ['Workflows'];
const security = [{ bearerAuth: [] }];

const definitionBody = z.object({
  name: z.string().trim().min(1).max(150),
  isActive: z.boolean().default(true),
  steps: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('manager') }),
        z.object({ type: z.literal('role'), roleId: z.uuid() }),
        z.object({ type: z.literal('user'), userId: z.uuid() }),
      ]),
    )
    .min(1)
    .max(5),
});

/** Workflow configuration (repository-level queries kept here: tiny, single-use). */
const definitions = {
  async list(auth: AuthContext) {
    const tenantId = requireTenantId(auth);
    const defs = await tenantScope(db, 'workflow_definitions', tenantId).select('*');
    const steps = await tenantScope(db, 'workflow_steps as s', tenantId)
      .leftJoin('roles as r', 'r.id', 's.role_id')
      .leftJoin('users as u', 'u.id', 's.user_id')
      .orderBy('s.step_order')
      .select(
        's.definition_id',
        's.step_order',
        's.approver_type',
        's.role_id',
        's.user_id',
        'r.name as role_name',
        'u.name as user_name',
      );
    return approvalEntityTypes().map(({ type, label }) => {
      const d = defs.find((x) => x.entity_type === type);
      return {
        entityType: type,
        label,
        configured: Boolean(d),
        name: d?.name ?? `${label} approval`,
        isActive: d?.is_active ?? true,
        steps: d
          ? steps
              .filter((st) => st.definition_id === d.id)
              .map((st) => ({
                order: st.step_order,
                type: st.approver_type,
                roleId: st.role_id,
                roleName: st.role_name,
                userId: st.user_id,
                userName: st.user_name,
              }))
          : [{ order: 1, type: 'manager' }],
      };
    });
  },
  async put(auth: AuthContext, entityType: string, body: z.infer<typeof definitionBody>) {
    const tenantId = requireTenantId(auth);
    if (!approvalEntityTypes().some((t) => t.type === entityType))
      throw new NotFoundError('Workflow');
    for (const st of body.steps) {
      if (
        st.type === 'role' &&
        !(await db('roles').where({ id: st.roleId, tenant_id: tenantId }).first('id'))
      )
        throw new BadRequestError('Unknown role');
      if (
        st.type === 'user' &&
        !(await db('tenant_memberships')
          .where({ user_id: st.userId, tenant_id: tenantId, is_active: true })
          .first('id'))
      )
        throw new BadRequestError('Unknown user');
    }
    // In-flight requests keep their snapshot of steps; changes apply to new submissions.
    await withTransaction(async (trx) => {
      const [def] = await trx('workflow_definitions')
        .insert({
          tenant_id: tenantId,
          entity_type: entityType,
          name: body.name,
          is_active: body.isActive,
        })
        .onConflict(['tenant_id', 'entity_type'])
        .merge(['name', 'is_active'])
        .returning<{ id: string }[]>('id');
      await trx('workflow_steps').where({ definition_id: def!.id }).delete();
      await trx('workflow_steps').insert(
        body.steps.map((st, i) => ({
          tenant_id: tenantId,
          definition_id: def!.id,
          step_order: i + 1,
          approver_type: st.type,
          role_id: st.type === 'role' ? st.roleId : null,
          user_id: st.type === 'user' ? st.userId : null,
        })),
      );
      await audit(trx, auth, 'workflow.configure', 'workflow_definitions', def!.id, body);
    });
    return (await definitions.list(auth)).find((d) => d.entityType === entityType);
  },
};

const delegationBody = z
  .object({ toUserId: z.uuid(), startDate: isoDate, endDate: isoDate })
  .refine((b) => b.endDate >= b.startDate, {
    message: 'End must be on or after start',
    path: ['endDate'],
  });

export const workflowRoutes: FastifyPluginAsyncZod = async (app) => {
  // Approval inbox: every member (decisions are authorized per request by the engine).
  app.get(
    '/approvals',
    {
      preHandler: authenticate,
      schema: {
        tags,
        security,
        summary: 'Approval inbox',
        querystring: z.object({
          box: z.enum(['assigned', 'mine', 'all']).default('assigned'),
          status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
          entityType: z.string().max(40).optional(),
        }),
      },
    },
    async (req, reply) => sendSuccess(reply, await s.list(req.auth!, req.query)),
  );
  app.get(
    '/approvals/:id',
    { preHandler: authenticate, schema: { tags, security, params: idParams } },
    async (req, reply) => sendSuccess(reply, await s.get(req.auth!, req.params.id)),
  );
  app.post(
    '/approvals/:id/decision',
    {
      preHandler: authenticate,
      schema: {
        tags,
        security,
        summary: 'Approve or reject the current step',
        params: idParams,
        body: z.object({ decision: z.enum(['approved', 'rejected']), comment: text(1000) }),
      },
    },
    async (req, reply) =>
      sendSuccess(
        reply,
        await s.decide(req.auth!, req.params.id, req.body.decision, req.body.comment ?? null),
        {
          message: `Request ${req.body.decision}`,
        },
      ),
  );

  const manage = requirePermissions(P.WORKFLOWS_MANAGE);
  app.get('/workflows', { preHandler: manage, schema: { tags, security } }, async (req, reply) =>
    sendSuccess(reply, await definitions.list(req.auth!)),
  );
  app.put(
    '/workflows/:entityType',
    {
      preHandler: manage,
      schema: {
        tags,
        security,
        params: z.object({ entityType: z.string().max(40) }),
        body: definitionBody,
      },
    },
    async (req, reply) =>
      sendSuccess(reply, await definitions.put(req.auth!, req.params.entityType, req.body), {
        message: 'Workflow saved',
      }),
  );

  // Delegations: a user delegates their own approvals; workflow admins see all.
  app.get(
    '/delegations',
    { preHandler: authenticate, schema: { tags, security } },
    async (req, reply) => {
      const tenantId = requireTenantId(req.auth);
      const rows = await tenantScope(db, 'approval_delegations as d', tenantId)
        .join('users as f', 'f.id', 'd.from_user_id')
        .join('users as t', 't.id', 'd.to_user_id')
        .modify((q) => {
          if (!req.auth!.permissions.has(P.WORKFLOWS_MANAGE))
            q.where((w) =>
              w.where('d.from_user_id', req.auth!.userId).orWhere('d.to_user_id', req.auth!.userId),
            );
        })
        .orderBy('d.start_date', 'desc')
        .select(
          'd.id',
          'd.start_date as startDate',
          'd.end_date as endDate',
          'f.name as fromName',
          't.name as toName',
          'd.from_user_id as fromUserId',
        );
      return sendSuccess(reply, rows);
    },
  );
  app.post(
    '/delegations',
    { preHandler: authenticate, schema: { tags, security, body: delegationBody } },
    async (req, reply) => {
      const tenantId = requireTenantId(req.auth);
      const member = await db('tenant_memberships')
        .where({ tenant_id: tenantId, user_id: req.body.toUserId, is_active: true })
        .first('id');
      if (!member) throw new BadRequestError('Unknown user');
      const row = await dbGuard('delegation', () =>
        withTransaction(async (trx) => {
          const [d] = await trx('approval_delegations')
            .insert({
              tenant_id: tenantId,
              from_user_id: req.auth!.userId,
              to_user_id: req.body.toUserId,
              start_date: req.body.startDate,
              end_date: req.body.endDate,
            })
            .returning('id');
          await audit(trx, req.auth!, 'delegation.create', 'approval_delegations', d.id, req.body);
          return d;
        }),
      );
      return sendSuccess(reply, row, { statusCode: 201, message: 'Delegation created' });
    },
  );
  app.delete(
    '/delegations/:id',
    { preHandler: authenticate, schema: { tags, security, params: idParams } },
    async (req, reply) => {
      const n = await tenantScope(db, 'approval_delegations', requireTenantId(req.auth))
        .where({ id: req.params.id })
        .modify(
          (q) =>
            !req.auth!.permissions.has(P.WORKFLOWS_MANAGE) &&
            q.where('from_user_id', req.auth!.userId),
        )
        .delete();
      if (!n) throw new NotFoundError('Delegation');
      return sendSuccess(reply, null, { message: 'Delegation removed' });
    },
  );
};
