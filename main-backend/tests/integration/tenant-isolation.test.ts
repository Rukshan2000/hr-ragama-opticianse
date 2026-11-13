import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/knex';
import { usersRepository } from '../../src/modules/users/users.repository';
import {
  API,
  PASSWORD,
  bearer,
  createMember,
  login,
  register,
  setupTestApp,
  toSession,
} from '../helpers/test-app';

const app = setupTestApp();
const get = (url: string, s: { accessToken: string }) =>
  app().inject({ url: `${API}${url}`, headers: bearer(s) });

describe('tenant isolation', () => {
  it("tenants never see each other's users or roles", async () => {
    const a = await register(app(), 'a@a.com', 'Tenant A');
    const b = await register(app(), 'b@b.com', 'Tenant B');
    const bUser = await createMember(app(), b, 'member@b.com', 'user');

    const listA = await get('/users', a);
    expect(listA.json().data.map((u: { email: string }) => u.email)).toEqual(['a@a.com']);
    expect((await get(`/users/${bUser.userId}`, a)).statusCode).toBe(404);

    const bRole = await db('roles').where({ tenant_id: b.tenantId, slug: 'admin' }).first('id');
    expect((await get(`/roles/${bRole.id}`, a)).statusCode).toBe(404);

    // Cannot attach another tenant's role to own user.
    const res = await app().inject({
      method: 'PATCH',
      url: `${API}/users/${a.userId}`,
      headers: bearer(a),
      payload: { name: 'A', roleIds: [bRole.id] },
    });
    expect(res.statusCode).toBe(400);

    // Cannot modify a user from another tenant.
    const patch = await app().inject({
      method: 'PATCH',
      url: `${API}/users/${bUser.userId}/status`,
      headers: bearer(a),
      payload: { isActive: false },
    });
    expect(patch.statusCode).toBe(404);
  });

  it('ignores client-supplied tenant ids', async () => {
    const a = await register(app(), 'a2@a.com', 'Tenant A2');
    const b = await register(app(), 'b2@b.com', 'Tenant B2');
    const res = await app().inject({
      url: `${API}/users?tenantId=${b.tenantId}`,
      headers: { ...bearer(a), 'x-tenant-id': b.tenantId! },
    });
    expect(res.json().data.map((u: { email: string }) => u.email)).toEqual(['a2@a.com']);
  });

  it('login into a tenant requires membership; multi-tenant users can switch', async () => {
    const a = await register(app(), 'multi@a.com', 'Alpha');
    const b = await register(app(), 'owner@b.com', 'Beta');
    expect((await login(app(), 'multi@a.com', { tenantSlug: b.tenantSlug! })).statusCode).toBe(403);

    // Make multi@a.com a member of Beta too.
    await db('tenant_memberships').insert({ tenant_id: b.tenantId, user_id: a.userId });
    const noSlug = (await login(app(), 'multi@a.com')).json().data;
    expect(noSlug.tenant).toBeNull(); // ambiguous -> platform context
    expect(noSlug.tenants).toHaveLength(2);

    const sw = await app().inject({
      method: 'POST',
      url: `${API}/auth/switch-tenant`,
      headers: bearer(noSlug.accessToken),
      payload: { tenantSlug: b.tenantSlug },
    });
    expect(sw.statusCode).toBe(200);
    const inB = toSession(sw.json().data);
    expect(inB.tenantId).toBe(b.tenantId);
    // Member of B but with no roles there: no permissions.
    expect((await get('/users', inB)).statusCode).toBe(403);
  });

  it('a token for a tenant stops working once the tenant is deactivated', async () => {
    const a = await register(app(), 'gone@a.com', 'Gone');
    await db('tenants').where({ id: a.tenantId }).update({ is_active: false });
    expect((await get('/auth/me', a)).statusCode).toBe(401);
  });

  it('repository queries are scoped to the given tenant', async () => {
    const a = await register(app(), 'r@a.com', 'RA');
    await register(app(), 'r@b.com', 'RB');
    const page = await usersRepository.list(a.tenantId!, {
      page: 1,
      limit: 10,
      sort: 'createdAt',
      order: 'desc',
    });
    expect(page.meta.total).toBe(1);
    expect(page.items[0]!.email).toBe('r@a.com');
    expect(PASSWORD).toBeTruthy();
  });
});
