import { describe, expect, it, vi } from 'vitest';
import { API, PASSWORD, bearer, setupTestApp } from '../helpers/test-app';

// Must run before the app (and its env/config) is imported.
vi.hoisted(() => {
  process.env.TENANCY_MODE = 'single';
});

const app = setupTestApp();
const post = (url: string, payload: object) =>
  app().inject({ method: 'POST', url: `${API}${url}`, payload });

describe('single-tenant mode', () => {
  it('puts every user in the default tenant: first is admin, the rest get the user role', async () => {
    const first = await post('/auth/register', { name: 'A', email: 'a@x.com', password: PASSWORD });
    const second = await post('/auth/register', {
      name: 'B',
      email: 'b@x.com',
      password: PASSWORD,
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().data.tenant.slug).toBe('default');
    expect(second.json().data.tenant.id).toBe(first.json().data.tenant.id);

    const login = await post('/auth/login', { email: 'b@x.com', password: PASSWORD });
    const me = await app().inject({
      url: `${API}/auth/me`,
      headers: bearer(login.json().data.accessToken),
    });
    expect(me.json().data.roles.map((r: { slug: string }) => r.slug)).toEqual(['user']);
  });

  it('does not expose tenant switching', async () => {
    const res = await post('/auth/switch-tenant', { tenantSlug: 'default' });
    expect(res.statusCode).toBe(404);
  });
});
