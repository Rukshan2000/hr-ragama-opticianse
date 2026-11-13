import { describe, expect, it } from 'vitest';
import {
  API,
  bearer,
  createMember,
  register,
  setupTestApp,
  type Session,
} from '../helpers/test-app';

const app = setupTestApp();
const call = (
  s: Session,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
) => app().inject({ method, url: `${API}/organization${url}`, headers: bearer(s), payload });

async function level(s: Session, name: string, rank: number) {
  const r = await call(s, 'POST', '/levels', { name, rank });
  expect(r.statusCode).toBe(201);
  return r.json().data.id as string;
}

describe('organization', () => {
  it('CRUDs branches with tenant-unique codes, filters and validation', async () => {
    const a = await register(app(), 'org-a@a.com', 'Org A');
    const created = await call(a, 'POST', '/branches', {
      code: 'hq',
      name: 'Head Office',
      timezone: 'Asia/Colombo',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ code: 'HQ', isActive: true });

    expect((await call(a, 'POST', '/branches', { code: 'HQ', name: 'Dup' })).statusCode).toBe(409);
    expect(
      (await call(a, 'POST', '/branches', { code: 'X', name: 'Bad', timezone: 'Mars/Base' }))
        .statusCode,
    ).toBe(422);

    const id = created.json().data.id;
    expect(
      (await call(a, 'PATCH', `/branches/${id}`, { isActive: false })).json().data.isActive,
    ).toBe(false);
    expect((await call(a, 'GET', '/branches?isActive=true')).json().data).toHaveLength(0);
    expect((await call(a, 'GET', '/branches?search=head')).json().data).toHaveLength(1);

    // Another tenant: same code is fine, and A's branch is invisible.
    const b = await register(app(), 'org-b@b.com', 'Org B');
    expect((await call(b, 'POST', '/branches', { code: 'HQ', name: 'B HQ' })).statusCode).toBe(201);
    expect((await call(b, 'GET', `/branches/${id}`)).statusCode).toBe(404);
    expect((await call(b, 'PATCH', `/branches/${id}`, { name: 'hijack' })).statusCode).toBe(404);
    expect((await call(b, 'DELETE', `/branches/${id}`)).statusCode).toBe(404);
    expect((await call(a, 'DELETE', `/branches/${id}`)).statusCode).toBe(200);
  });

  it('builds a hierarchy and rejects level inversions, cycles and in-use deletes', async () => {
    const a = await register(app(), 'chart@a.com', 'Chart Co');
    const company = await level(a, 'Company', 1);
    const division = await level(a, 'Division', 2);
    const team = await level(a, 'Team', 3);

    const root = (await call(a, 'POST', '/units', { name: 'Chart Co', levelId: company })).json()
      .data.id;
    const div = (
      await call(a, 'POST', '/units', { name: 'Engineering', levelId: division, parentId: root })
    ).json().data.id;
    const t = (
      await call(a, 'POST', '/units', { name: 'Platform', levelId: team, parentId: div })
    ).json().data.id;

    // Child at same/higher level than parent
    expect(
      (await call(a, 'POST', '/units', { name: 'Bad', levelId: company, parentId: div }))
        .statusCode,
    ).toBe(400);
    // Cycle: move Engineering under its own descendant
    expect((await call(a, 'PATCH', `/units/${div}`, { parentId: t })).statusCode).toBe(400);
    // Raising a unit above its children's level
    expect((await call(a, 'PATCH', `/units/${t}`, { levelId: division })).statusCode).toBe(400);
    // Level in use cannot be re-ranked; delete blocked while referenced
    expect((await call(a, 'PATCH', `/levels/${team}`, { rank: 9 })).statusCode).toBe(409);
    expect((await call(a, 'DELETE', `/levels/${team}`)).statusCode).toBe(409);
    // Parent with children cannot be deleted
    expect((await call(a, 'DELETE', `/units/${div}`)).statusCode).toBe(409);

    const units = (await call(a, 'GET', '/units')).json().data;
    expect(units).toHaveLength(3);
    expect(units.find((u: { id: string }) => u.id === t)).toMatchObject({
      parentId: div,
      level: { name: 'Team', rank: 3 },
    });

    // Cross-tenant parent/level ids are rejected
    const b = await register(app(), 'chart@b.com', 'Other');
    const bLevel = await level(b, 'Company', 1);
    expect(
      (await call(b, 'POST', '/units', { name: 'x', levelId: bLevel, parentId: root })).statusCode,
    ).toBe(400);
    expect((await call(a, 'POST', '/units', { name: 'x', levelId: bLevel })).statusCode).toBe(400);
  });

  it('enforces read vs manage permissions', async () => {
    const admin = await register(app(), 'perm@a.com', 'Perm Co');
    const emp = await createMember(app(), admin, 'emp@a.com', 'employee');
    const plain = await createMember(app(), admin, 'plain@a.com', 'user');
    expect((await call(emp, 'GET', '/departments')).statusCode).toBe(200);
    expect((await call(emp, 'POST', '/departments', { code: 'D', name: 'D' })).statusCode).toBe(
      403,
    );
    expect((await call(plain, 'GET', '/departments')).statusCode).toBe(403);
    const hr = await createMember(app(), admin, 'hr@a.com', 'hr-admin');
    expect((await call(hr, 'POST', '/departments', { code: 'D', name: 'D' })).statusCode).toBe(201);
  });
});
