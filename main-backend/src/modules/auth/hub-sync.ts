import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db, withTransaction, type DbExecutor } from '../../database/knex';
import {
  PERMISSION_DESCRIPTIONS,
  TENANT_PERMISSIONS,
  type Permission,
} from '../../shared/constants/permissions';
import { ConflictError, UnauthorizedError } from '../../shared/errors/app-error';
import { hashPassword } from '../../shared/utils/password';
import { rolesRepository } from '../roles/roles.repository';
import { usersRepository } from '../users/users.repository';
import { redeem } from './hub.service';
import { applyOrg, applyUserCompanies } from './hub-sync.org';

const unit = z.object({
  id: z.uuid(),
  kind: z.enum(['branch', 'department', 'division', 'designation']),
  companyId: z.uuid().nullable(),
  parentId: z.uuid().nullable(),
  code: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  isHeadOffice: z.boolean(),
  isActive: z.boolean(),
});
const company = z.looseObject({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
});
const snapshotSchema = z.object({
  organization: z.object({ name: z.string().trim().min(1).max(200) }).optional(),
  companies: z.array(company),
  units: z.array(unit),
  // Org chart levels; older hubs don't send them, and then local levels stay as they are.
  levels: z
    .array(z.object({ id: z.uuid(), name: z.string().min(1).max(100), rank: z.number().int().positive() }))
    .optional(),
  roles: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      slug: z.string(),
      description: z.string().nullable(),
      permissions: z.array(z.string()),
    }),
  ),
  users: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      email: z.string(),
      isActive: z.boolean(),
      roleIds: z.array(z.uuid()),
      companies: z.array(
        z.object({ companyId: z.uuid(), branchIds: z.array(z.uuid()).nullable() }),
      ),
    }),
  ),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export type HubUnit = z.infer<typeof unit>;
export type HubCompany = z.infer<typeof company>;

/** hub id -> local id; links once by natural key (email/code/slug), creates otherwise. */
export async function link(
  trx: DbExecutor,
  entity: string,
  tenantId: string,
  hubId: string,
  find: () => Promise<string | undefined>,
  create: () => Promise<string>,
): Promise<{ id: string; created: boolean }> {
  const row = await trx('hub_links')
    .where({ entity, hub_id: hubId, tenant_id: tenantId })
    .first('local_id');
  if (row) return { id: row.local_id, created: false };
  let id = await find();
  const created = !id;
  id ??= await create();
  await trx('hub_links').insert({ entity, hub_id: hubId, local_id: id, tenant_id: tenantId });
  return { id, created };
}

/** Local ids linked for this tenant that the hub no longer sends. */
export async function stale(
  trx: DbExecutor,
  entity: string,
  tenantId: string,
  keep: Iterable<string>,
) {
  return trx('hub_links')
    .where({ entity, tenant_id: tenantId })
    .whereNotIn('hub_id', [...keep])
    .pluck('local_id') as Promise<string[]>;
}

export async function isHubManaged(tenantId: string) {
  return Boolean(
    await db('hub_links').where({ entity: 'tenant', tenant_id: tenantId }).first('local_id'),
  );
}

const ALLOWED = new Set<string>(TENANT_PERMISSIONS);

/** Applies InvoHub's full snapshot for one tenant; returns this app's permission catalog. */
export async function hubSync(token: string, data: string) {
  const claims = await redeem(token, 'sync');
  if (createHash('sha256').update(data).digest('hex') !== claims.body_sha256)
    throw new UnauthorizedError('Payload does not match its signature');
  const tenantId = claims.ext_tenant;
  if (
    typeof tenantId !== 'string' ||
    !(await db('tenants').where({ id: tenantId }).whereNull('deleted_at').first('id'))
  )
    throw new ConflictError('Unknown tenant: set the right tenant id in InvoHub');
  const catalog = {
    permissions: TENANT_PERMISSIONS.map((key) => ({
      key,
      description: PERMISSION_DESCRIPTIONS[key],
    })),
  };
  const body = JSON.parse(data) as unknown;
  // Sync still off in InvoHub: report the catalog, change nothing.
  if ((body as { catalogOnly?: boolean }).catalogOnly === true) return catalog;
  const snap = snapshotSchema.parse(body);

  await withTransaction(async (trx) => {
    await trx('hub_links')
      .insert({ entity: 'tenant', hub_id: claims.org, local_id: tenantId, tenant_id: tenantId })
      .onConflict()
      .ignore();
    // The organization's name follows InvoHub, including the org chart's top unit.
    if (snap.organization) {
      await trx('tenants').where({ id: tenantId }).update({ name: snap.organization.name });
      await trx('org_units')
        .where({ tenant_id: tenantId, code: 'ORG' })
        .update({ name: snap.organization.name });
    }

    // Roles and their permissions in this app.
    const roleIds = new Map<string, string>();
    for (const r of snap.roles) {
      const { id } = await link(
        trx,
        'role',
        tenantId,
        r.id,
        async () =>
          (await trx('roles').where({ tenant_id: tenantId, slug: r.slug }).first('id'))?.id,
        async () =>
          (
            await trx('roles')
              .insert({
                tenant_id: tenantId,
                name: r.name,
                slug: r.slug,
                description: r.description,
              })
              .returning('id')
          )[0].id,
      );
      await trx('roles').where({ id }).update({ name: r.name, description: r.description });
      await rolesRepository.setPermissions(
        id,
        r.permissions.filter((p) => ALLOWED.has(p)) as Permission[],
        trx,
      );
      roleIds.set(r.id, id);
    }
    for (const id of await stale(trx, 'role', tenantId, roleIds.keys()))
      await rolesRepository.setPermissions(id, [], trx); // kept (may be referenced), but grants nothing

    const org = await applyOrg(trx, tenantId, snap);

    // Users: linked by email; the hub decides membership, roles and company access.
    const userIds = new Map<string, string>();
    for (const u of snap.users) {
      const email = u.email.toLowerCase();
      const { id } = await link(
        trx,
        'user',
        tenantId,
        u.id,
        async () => (await trx('users').where({ email }).whereNull('deleted_at').first('id'))?.id,
        // Signs in through InvoHub; the local password is random and unknown.
        async () =>
          usersRepository.insertUser(
            {
              name: u.name,
              email,
              password_hash: await hashPassword(randomBytes(32).toString('base64url')),
            },
            trx,
          ),
      );
      await trx('users').where({ id }).update({ name: u.name });
      await trx('tenant_memberships')
        .insert({ tenant_id: tenantId, user_id: id, is_active: u.isActive })
        .onConflict(['tenant_id', 'user_id'])
        .merge(['is_active']);
      await usersRepository.replaceTenantRoles(
        tenantId,
        id,
        u.roleIds.map((r) => roleIds.get(r)).filter((r): r is string => !!r),
        trx,
      );
      userIds.set(u.id, id);
    }
    // Start fresh: anyone in this tenant the hub didn't send loses access here.
    await trx('tenant_memberships')
      .where({ tenant_id: tenantId })
      .whereNotIn('user_id', [...userIds.values()])
      .update({ is_active: false });
    await applyUserCompanies(
      trx,
      tenantId,
      snap.users.map((u) => ({ id: userIds.get(u.id)!, companies: u.companies })),
      org,
    );
  });

  return catalog;
}
