import { DEFAULT_TENANT_ROLES } from '../../src/shared/constants/permissions';
import { describe, expect, it } from 'vitest';
import { db, withTransaction } from '../../src/database/knex';
import { seed } from '../../src/database/seeds/01_permissions_and_platform_roles';
import { rolesRepository } from '../../src/modules/roles/roles.repository';
import { usersRepository } from '../../src/modules/users/users.repository';
import { API, PASSWORD, bearer, register, setupTestApp } from '../helpers/test-app';

const app = setupTestApp();

describe('repositories & transactions', () => {
  it('rolls back every write when a transaction fails', async () => {
    await expect(
      withTransaction(async (trx) => {
        await usersRepository.insertUser(
          { name: 'T', email: 'trx@x.com', password_hash: 'h' },
          trx,
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db('users').where({ email: 'trx@x.com' }).first()).toBeUndefined();
  });

  it('registration is atomic: a failing step leaves no partial user', async () => {
    await register(app(), 'first@x.com', 'Same Org');
    // Duplicate email fails at insert, before any tenant is created.
    const before = await db('tenants').count({ c: '*' }).first();
    const res = await app().inject({
      method: 'POST',
      url: `${API}/auth/register`,
      payload: { name: 'X', email: 'first@x.com', password: PASSWORD, organizationName: 'New Org' },
    });
    expect(res.statusCode).toBe(409);
    expect(await db('tenants').count({ c: '*' }).first()).toEqual(before);
  });

  it('paginates grouped queries with correct totals', async () => {
    const s = await register(app(), 'page@x.com');
    const page = await rolesRepository.list(s.tenantId!, {
      page: 1,
      limit: 2,
      sort: 'name',
      order: 'asc',
    });
    const total = DEFAULT_TENANT_ROLES.length;
    expect(page.meta).toEqual({ page: 1, limit: 2, total, totalPages: Math.ceil(total / 2) });
    expect(page.items.map((r) => r.slug)).toEqual(['admin', 'department-manager']);
  });

  it('supports search, filter and sort through the API', async () => {
    const s = await register(app(), 'owner@x.com');
    for (const n of ['Zed', 'Amy', 'Bob']) {
      await app().inject({
        method: 'POST',
        url: `${API}/users`,
        headers: bearer(s),
        payload: { name: n, email: `${n.toLowerCase()}@x.com`, password: PASSWORD },
      });
    }
    const sorted = await app().inject({
      url: `${API}/users?sort=name&order=asc&limit=2`,
      headers: bearer(s),
    });
    expect(sorted.json().data.map((u: { name: string }) => u.name)).toEqual(['Amy', 'Bob']);
    expect(sorted.json().meta).toMatchObject({ total: 4, totalPages: 2 });

    const search = await app().inject({ url: `${API}/users?search=zed`, headers: bearer(s) });
    expect(search.json().data).toHaveLength(1);

    const bad = await app().inject({ url: `${API}/users?sort=password_hash`, headers: bearer(s) });
    expect(bad.statusCode).toBe(422);
  });

  it('updated_at is maintained by the database trigger', async () => {
    const s = await register(app(), 'trg@x.com');
    const before = await db('users').where({ id: s.userId }).first('updated_at');
    await new Promise((r) => setTimeout(r, 20));
    await db('users').where({ id: s.userId }).update({ name: 'Changed' });
    const after = await db('users').where({ id: s.userId }).first('updated_at');
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  });

  it('seeds are idempotent', async () => {
    await seed(db);
    const row = await db('roles').whereNull('tenant_id').count({ c: '*' }).first();
    expect(Number(row?.c)).toBe(1);
  });
});
