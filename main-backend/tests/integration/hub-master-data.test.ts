import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/knex';
import {
  API,
  PASSWORD,
  bearer,
  createMember,
  login,
  register,
  setupTestApp,
} from '../helpers/test-app';

const app = setupTestApp();
const KEY = readFileSync(`${__dirname}/../helpers/hub-test-key.pem`, 'utf8');
const AUD = 'invoteam';

function push(tenantId: string, snapshot: object, tamper = false) {
  const data = JSON.stringify(snapshot);
  const token = jwt.sign(
    {
      typ: 'sync',
      org: randomUUID(),
      ext_tenant: tenantId,
      body_sha256: createHash('sha256').update(data).digest('hex'),
    },
    KEY,
    { algorithm: 'RS256', issuer: 'invohub', audience: AUD, expiresIn: 60, jwtid: randomUUID() },
  );
  const send = () =>
    app().inject({
      method: 'POST',
      url: `${API}/auth/hub/sync`,
      payload: { token, data: tamper ? data.replace('Acme', 'Evil') : data },
    });
  return { send, token };
}

const ids = {
  co: randomUUID(),
  br: randomUUID(),
  hq: randomUUID(),
  dep: randomUUID(),
  div: randomUUID(),
  des: randomUUID(),
  role: randomUUID(),
  user: randomUUID(),
  levels: [randomUUID(), randomUUID(), randomUUID()],
};
const unit = (id: string, kind: string, code: string, extra: object = {}) => ({
  id,
  kind,
  code,
  name: `${kind} ${code}`,
  companyId: kind === 'designation' ? null : ids.co,
  parentId: null,
  address: null,
  phone: null,
  email: null,
  isHeadOffice: false,
  isActive: true,
  ...extra,
});
const snapshot = (perm: string) => ({
  companies: [{ id: ids.co, code: 'ACME', name: 'Acme Ltd', isActive: true, tin: '123' }],
  units: [
    unit(ids.hq, 'branch', 'HQ', { isHeadOffice: true }),
    unit(ids.br, 'branch', 'KDY'),
    unit(ids.dep, 'department', 'FIN', { parentId: ids.hq }),
    unit(ids.div, 'division', 'AP', { parentId: ids.dep }),
    unit(ids.des, 'designation', 'MGR'),
  ],
  levels: ['Company', 'Branch', 'Department'].map((name, i) => ({
    id: ids.levels[i]!,
    name,
    rank: i + 1,
  })),
  roles: [
    {
      id: ids.role,
      name: 'Hub Role',
      slug: 'hub-role',
      description: null,
      permissions: [perm, 'not:a-permission'],
    },
  ],
  users: [
    {
      id: ids.user,
      name: 'Hub Person',
      email: 'Person@Hub.test',
      isActive: true,
      roleIds: [ids.role],
      companies: [{ companyId: ids.co, branchIds: null }],
    },
  ],
});

describe('InvoHub master-data sync', () => {
  it('applies the snapshot, reports its catalog, then locks local edits', async () => {
    const owner = await register(app(), 'owner@sync.test');
    const other = await createMember(app(), owner, 'other@sync.test', 'user');

    expect((await push(owner.tenantId!, snapshot('users:read'), true).send()).statusCode).toBe(401);
    // Local levels: 'Branch' gets linked and re-ranked, unused 'Legacy' goes away.
    await db('org_levels').insert([
      { tenant_id: owner.tenantId, name: 'Branch', rank: 1 },
      { tenant_id: owner.tenantId, name: 'Legacy', rank: 5 },
    ]);

    const p = push(owner.tenantId!, snapshot('users:read'));
    const res = await p.send();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.permissions.map((x: { key: string }) => x.key)).toContain('users:read');
    expect((await p.send()).statusCode).toBe(401); // single use

    const user = await db('users').where({ email: 'person@hub.test' }).first('id');
    const roles = await db('user_roles as ur')
      .join('roles as r', 'r.id', 'ur.role_id')
      .where('ur.user_id', user.id)
      .pluck('r.slug');
    expect(roles).toEqual(['hub-role']);
    const perms = await db('role_permissions as rp')
      .join('permissions as p', 'p.id', 'rp.permission_id')
      .join('roles as r', 'r.id', 'rp.role_id')
      .where('r.slug', 'hub-role')
      .pluck('p.key');
    expect(perms).toEqual(['users:read']);

    // Start fresh: members the hub didn't send (including the old owner) lose access here.
    const active = await db('tenant_memberships')
      .where({ tenant_id: owner.tenantId, is_active: true })
      .pluck('user_id');
    expect(active).toEqual([user.id]);
    expect(other).toBeTruthy();
    expect(
      await db('branches').where({ tenant_id: owner.tenantId }).orderBy('code').pluck('code'),
    ).toEqual(['HQ', 'KDY']);
    expect(await db('departments').where({ tenant_id: owner.tenantId }).pluck('code')).toEqual([
      'FIN',
    ]);
    expect(await db('designations').where({ tenant_id: owner.tenantId }).pluck('code')).toEqual([
      'MGR',
    ]);
    const levels = () =>
      db('org_levels').where({ tenant_id: owner.tenantId }).orderBy('rank').pluck('name');
    expect(await levels()).toEqual(['Company', 'Branch', 'Department']);
    // Second push is idempotent and links, never duplicates.
    expect((await push(owner.tenantId!, snapshot('roles:read')).send()).statusCode).toBe(200);
    expect(
      await db('roles')
        .where({ tenant_id: owner.tenantId, slug: 'hub-role' })
        .count('* as n')
        .first(),
    ).toMatchObject({ n: '1' });
    expect(await levels()).toEqual(['Company', 'Branch', 'Department']);

    // Local edits of hub-owned data are refused.
    await db('tenant_memberships')
      .where({ tenant_id: owner.tenantId, user_id: owner.userId })
      .update({ is_active: true });
    const s = (await login(app(), 'owner@sync.test', { password: PASSWORD })).json().data;
    const create = await app().inject({
      method: 'POST',
      url: `${API}/users`,
      headers: bearer(s.accessToken),
      payload: { name: 'X', email: 'x@sync.test', password: PASSWORD },
    });
    expect(create.statusCode).toBe(409);
    expect(create.json().message).toMatch(/InvoHub/);
  });

  it('catalog-only request changes nothing', async () => {
    const owner = await register(app(), 'cat@sync.test');
    const res = await push(owner.tenantId!, { catalogOnly: true }).send();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.permissions.length).toBeGreaterThan(0);
    expect(await db('hub_links').where({ tenant_id: owner.tenantId }).first()).toBeUndefined();
    expect(
      await db('tenant_memberships')
        .where({ tenant_id: owner.tenantId, user_id: owner.userId })
        .first('is_active'),
    ).toEqual({ is_active: true });
  });

  it('refuses an unknown tenant', async () => {
    expect((await push(randomUUID(), snapshot('users:read')).send()).statusCode).toBe(409);
  });
});
