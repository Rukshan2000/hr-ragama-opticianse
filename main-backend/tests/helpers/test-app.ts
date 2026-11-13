import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { buildApp } from '../../src/app';
import { db } from '../../src/database/knex';
import { hashPassword } from '../../src/shared/utils/password';

export const PASSWORD = 'Password123!';
export const API = '/api/v1';

/** Wipes tenant and user data but keeps reference data (permissions, platform roles). */
export async function resetDatabase(): Promise<void> {
  await db.raw('DELETE FROM tenants; DELETE FROM users;'); // FKs cascade to everything else
}

/** Registers the standard lifecycle hooks and returns a getter for the app. */
export function setupTestApp(): () => FastifyInstance {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });
  beforeEach(resetDatabase);
  afterAll(async () => {
    await app.close();
    await db.destroy();
  });
  return () => app;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  userId: string;
  tenantId: string | null;
  tenantSlug: string | null;
}

export async function register(
  app: FastifyInstance,
  email: string,
  organizationName = `Org ${email}`,
): Promise<Session> {
  const res = await app.inject({
    method: 'POST',
    url: `${API}/auth/register`,
    payload: { name: 'Test User', email, password: PASSWORD, organizationName },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  return toSession(res.json().data);
}

export async function login(
  app: FastifyInstance,
  email: string,
  extra: { password?: string; tenantSlug?: string } = {},
) {
  return app.inject({
    method: 'POST',
    url: `${API}/auth/login`,
    payload: { email, password: extra.password ?? PASSWORD, tenantSlug: extra.tenantSlug },
  });
}

export function toSession(data: {
  accessToken: string;
  refreshToken: string;
  user: { id: string };
  tenant: { id: string; slug: string } | null;
}): Session {
  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    userId: data.user.id,
    tenantId: data.tenant?.id ?? null,
    tenantSlug: data.tenant?.slug ?? null,
  };
}

export const bearer = (s: { accessToken: string } | string) => ({
  authorization: `Bearer ${typeof s === 'string' ? s : s.accessToken}`,
});

/** Platform super admin (no tenant), created directly in the DB like the seed does. */
export async function createSuperAdmin(app: FastifyInstance, email = 'root@platform.test') {
  const [user] = await db('users')
    .insert({ name: 'Root', email, password_hash: await hashPassword(PASSWORD) })
    .returning('id');
  const role = await db('roles').whereNull('tenant_id').where({ slug: 'super-admin' }).first('id');
  await db('user_roles').insert({ user_id: user.id, role_id: role.id });
  const res = await login(app, email);
  return toSession(res.json().data);
}

/** Creates a user in the session's tenant with the given role slug and logs them in. */
export async function createMember(
  app: FastifyInstance,
  admin: Session,
  email: string,
  roleSlug: string,
): Promise<Session> {
  const role = await db('roles').where({ tenant_id: admin.tenantId, slug: roleSlug }).first('id');
  const res = await app.inject({
    method: 'POST',
    url: `${API}/users`,
    headers: bearer(admin),
    payload: { name: roleSlug, email, password: PASSWORD, roleIds: [role.id] },
  });
  if (res.statusCode !== 201) throw new Error(`createMember failed: ${res.body}`);
  return toSession((await login(app, email, { tenantSlug: admin.tenantSlug! })).json().data);
}
