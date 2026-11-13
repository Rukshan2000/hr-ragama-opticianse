import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/knex';
import {
  API,
  PASSWORD,
  bearer,
  createMember,
  createSuperAdmin,
  register,
  setupTestApp,
} from '../helpers/test-app';

const app = setupTestApp();
const req = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  headers: object,
  payload?: object,
) =>
  app().inject({
    method,
    url: `${API}${url}`,
    headers: headers as Record<string, string>,
    payload,
  });

describe('role-based access control', () => {
  it('User role can read users but not create them', async () => {
    const admin = await register(app(), 'admin@a.com');
    const user = await createMember(app(), admin, 'user@a.com', 'user');
    expect((await req('GET', '/users', bearer(user))).statusCode).toBe(200);
    const res = await req('POST', '/users', bearer(user), {
      name: 'X',
      email: 'x@a.com',
      password: PASSWORD,
    });
    expect(res.statusCode).toBe(403);
    expect((await req('GET', '/roles', bearer(user))).statusCode).toBe(403);
  });

  it('Manager can add users but cannot grant roles (privilege escalation guard)', async () => {
    const admin = await register(app(), 'admin@b.com');
    const manager = await createMember(app(), admin, 'mgr@b.com', 'manager');
    const plain = await req('POST', '/users', bearer(manager), {
      name: 'New',
      email: 'new@b.com',
      password: PASSWORD,
    });
    expect(plain.statusCode).toBe(201);
    expect(plain.json().data.roles.map((r: { slug: string }) => r.slug)).toEqual(['user']);

    const adminRole = await db('roles')
      .where({ tenant_id: admin.tenantId, slug: 'admin' })
      .first('id');
    const escalate = await req('PATCH', `/users/${plain.json().data.id}`, bearer(manager), {
      roleIds: [adminRole.id],
    });
    expect(escalate.statusCode).toBe(403);
  });

  it('role changes apply to existing tokens immediately', async () => {
    const admin = await register(app(), 'admin@c.com');
    const user = await createMember(app(), admin, 'user@c.com', 'user');
    const managerRole = await db('roles')
      .where({ tenant_id: admin.tenantId, slug: 'manager' })
      .first('id');
    await req('PATCH', `/users/${user.userId}`, bearer(admin), { roleIds: [managerRole.id] });
    expect((await req('GET', '/roles', bearer(user))).statusCode).toBe(200);
  });

  it('Admin manages custom roles; system roles are protected', async () => {
    const admin = await register(app(), 'admin@d.com');
    const created = await req('POST', '/roles', bearer(admin), {
      name: 'Auditor',
      permissions: ['users:read', 'roles:read'],
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({
      slug: 'auditor',
      isSystem: false,
      permissions: ['roles:read', 'users:read'],
    });

    expect(
      (await req('POST', '/roles', bearer(admin), { name: 'Auditor', permissions: [] })).statusCode,
    ).toBe(409);
    const platformPerm = await req('POST', '/roles', bearer(admin), {
      name: 'Sneaky',
      permissions: ['tenants:manage'],
    });
    expect(platformPerm.statusCode).toBe(422);

    const id = created.json().data.id;
    const updated = await req('PATCH', `/roles/${id}`, bearer(admin), {
      permissions: ['users:read'],
    });
    expect(updated.json().data.permissions).toEqual(['users:read']);
    expect((await req('DELETE', `/roles/${id}`, bearer(admin))).statusCode).toBe(200);

    const system = await db('roles').where({ tenant_id: admin.tenantId, slug: 'user' }).first('id');
    expect((await req('DELETE', `/roles/${system.id}`, bearer(admin))).statusCode).toBe(403);
  });

  it('tenant admins cannot reach platform endpoints; super admin can', async () => {
    const admin = await register(app(), 'admin@e.com');
    expect((await req('GET', '/tenants', bearer(admin))).statusCode).toBe(403);

    const root = await createSuperAdmin(app());
    expect(root.tenantId).toBeNull();
    const list = await req('GET', '/tenants?search=admin@e', bearer(root));
    expect(list.statusCode).toBe(200);
    expect(list.json().meta.total).toBe(1);

    const created = await req('POST', '/tenants', bearer(root), {
      name: 'Globex',
      slug: 'globex',
      owner: { name: 'Owner', email: 'owner@globex.com', password: PASSWORD },
    });
    expect(created.statusCode).toBe(201);
    const ownerLogin = await app().inject({
      method: 'POST',
      url: `${API}/auth/login`,
      payload: { email: 'owner@globex.com', password: PASSWORD },
    });
    expect(ownerLogin.json().data.tenant.slug).toBe('globex');

    // Super admin has no tenant context, so tenant-scoped endpoints refuse.
    expect((await req('GET', '/users', bearer(root))).statusCode).toBe(403);
  });

  it('users cannot deactivate or remove themselves', async () => {
    const admin = await register(app(), 'admin@f.com');
    expect(
      (await req('PATCH', `/users/${admin.userId}/status`, bearer(admin), { isActive: false }))
        .statusCode,
    ).toBe(403);
    expect((await req('DELETE', `/users/${admin.userId}`, bearer(admin))).statusCode).toBe(403);
  });

  it('deactivating and removing members', async () => {
    const admin = await register(app(), 'admin@g.com');
    const user = await createMember(app(), admin, 'user@g.com', 'user');
    const off = await req('PATCH', `/users/${user.userId}/status`, bearer(admin), {
      isActive: false,
    });
    expect(off.json().data.isActive).toBe(false);
    expect((await req('GET', '/auth/me', bearer(user))).statusCode).toBe(401);

    expect((await req('DELETE', `/users/${user.userId}`, bearer(admin))).statusCode).toBe(200);
    const row = await db('users').where({ id: user.userId }).first();
    expect(row.deleted_at).not.toBeNull(); // no access left anywhere -> soft-deleted
  });
});
