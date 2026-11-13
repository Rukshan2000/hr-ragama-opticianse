import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/knex';
import { authService } from '../../src/modules/auth/auth.service';
import { API, PASSWORD, bearer, login, register, setupTestApp } from '../helpers/test-app';

const app = setupTestApp();
const post = (url: string, payload: object, headers = {}) =>
  app().inject({ method: 'POST', url: `${API}${url}`, payload, headers });

describe('registration', () => {
  it('creates the user, their tenant and admin role; never exposes the hash', async () => {
    const res = await post('/auth/register', {
      name: 'Alice',
      email: 'Alice@Example.com',
      password: PASSWORD,
      organizationName: 'Acme Inc',
    });
    expect(res.statusCode).toBe(201);
    const { data } = res.json();
    expect(data).toMatchObject({
      tokenType: 'Bearer',
      user: { email: 'alice@example.com' },
      tenant: { slug: 'acme-inc' },
    });
    expect(res.body).not.toMatch(/password_hash|argon2/);

    const me = await app().inject({ url: `${API}/auth/me`, headers: bearer(data.accessToken) });
    expect(me.json().data.roles.map((r: { slug: string }) => r.slug)).toEqual(['admin']);
    expect(me.json().data.permissions).toContain('users:create');
    expect(me.json().data.permissions).not.toContain('tenants:manage');
  });

  it('rejects duplicate emails (case-insensitive) with 409', async () => {
    await register(app(), 'dup@example.com');
    const res = await post('/auth/register', {
      name: 'X',
      email: 'DUP@example.com',
      password: PASSWORD,
      organizationName: 'Other',
    });
    expect(res.statusCode).toBe(409);
  });

  it('validates input with field-level errors', async () => {
    const res = await post('/auth/register', {
      name: '',
      email: 'x',
      password: 'weak',
      organizationName: 'A',
    });
    expect(res.statusCode).toBe(422);
    const fields = res.json().errors.map((e: { field: string }) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['body.email', 'body.password', 'body.name']));
  });
});

describe('login & guards', () => {
  it('logs in and rejects bad credentials generically', async () => {
    await register(app(), 'bob@example.com');
    expect((await login(app(), 'bob@example.com')).statusCode).toBe(200);
    const wrong = await login(app(), 'bob@example.com', { password: 'WrongPass123' });
    const unknown = await login(app(), 'ghost@example.com');
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().message).toBe(unknown.json().message);
  });

  it('locks the account after repeated failures', async () => {
    await register(app(), 'lock@example.com');
    for (let i = 0; i < 5; i++)
      await login(app(), 'lock@example.com', { password: 'WrongPass123' });
    expect((await login(app(), 'lock@example.com')).statusCode).toBe(429);
  });

  it('requires a valid bearer token', async () => {
    expect((await app().inject(`${API}/auth/me`)).statusCode).toBe(401);
    const res = await app().inject({ url: `${API}/auth/me`, headers: bearer('garbage') });
    expect(res.statusCode).toBe(401);
  });

  it('blocks deactivated accounts immediately, including existing tokens', async () => {
    const s = await register(app(), 'off@example.com');
    await db('users').where({ id: s.userId }).update({ is_active: false });
    expect((await app().inject({ url: `${API}/auth/me`, headers: bearer(s) })).statusCode).toBe(
      401,
    );
    expect((await login(app(), 'off@example.com')).statusCode).toBe(403);
  });
});

describe('refresh token rotation', () => {
  it('rotates: old token is single-use, new token works', async () => {
    const s = await register(app(), 'rot@example.com');
    const r1 = await post('/auth/refresh', { refreshToken: s.refreshToken });
    expect(r1.statusCode).toBe(200);
    const next = r1.json().data.refreshToken;
    expect(next).not.toBe(s.refreshToken);
    expect((await post('/auth/refresh', { refreshToken: next })).statusCode).toBe(200);
  });

  it('detects reuse and revokes the whole session family', async () => {
    const s = await register(app(), 'reuse@example.com');
    const rotated = (await post('/auth/refresh', { refreshToken: s.refreshToken })).json().data
      .refreshToken;

    const replay = await post('/auth/refresh', { refreshToken: s.refreshToken });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().message).toMatch(/reuse/i);
    // The legitimately rotated token is now revoked too.
    expect((await post('/auth/refresh', { refreshToken: rotated })).statusCode).toBe(401);
  });

  it('stores only hashes of refresh tokens', async () => {
    const s = await register(app(), 'hash@example.com');
    const rows = await db('refresh_tokens').where({ user_id: s.userId });
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].token_hash).not.toBe(s.refreshToken);
  });

  it('logout revokes the session; logout-all revokes every session', async () => {
    const s = await register(app(), 'out@example.com');
    expect((await post('/auth/logout', { refreshToken: s.refreshToken })).statusCode).toBe(200);
    expect((await post('/auth/refresh', { refreshToken: s.refreshToken })).statusCode).toBe(401);

    const second = (await login(app(), 'out@example.com')).json().data;
    const third = (await login(app(), 'out@example.com')).json().data;
    expect((await post('/auth/logout-all', {}, bearer(third.accessToken))).statusCode).toBe(200);
    expect((await post('/auth/refresh', { refreshToken: second.refreshToken })).statusCode).toBe(
      401,
    );
  });
});

describe('password management', () => {
  it('change-password requires the current password and revokes sessions', async () => {
    const s = await register(app(), 'cp@example.com');
    const bad = await post(
      '/auth/change-password',
      { currentPassword: 'WrongPass123', newPassword: 'NewPassword456' },
      bearer(s),
    );
    expect(bad.statusCode).toBe(401);

    // Ensure the change lands in a later second than the token's iat.
    await new Promise((r) => setTimeout(r, 1100));
    const ok = await post(
      '/auth/change-password',
      { currentPassword: PASSWORD, newPassword: 'NewPassword456' },
      bearer(s),
    );
    expect(ok.statusCode).toBe(200);
    expect((await post('/auth/refresh', { refreshToken: s.refreshToken })).statusCode).toBe(401);
    expect((await app().inject({ url: `${API}/auth/me`, headers: bearer(s) })).statusCode).toBe(
      401,
    );
    expect((await login(app(), 'cp@example.com', { password: 'NewPassword456' })).statusCode).toBe(
      200,
    );
  });

  it('forgot/reset password: same response for unknown email, token is single-use', async () => {
    await register(app(), 'reset@example.com');
    const unknown = await post('/auth/forgot-password', { email: 'nobody@example.com' });
    const known = await post('/auth/forgot-password', { email: 'reset@example.com' });
    expect(unknown.json().message).toBe(known.json().message);

    const token = await authService.requestPasswordReset('reset@example.com');
    expect(token).toBeTruthy();
    const reset = await post('/auth/reset-password', { token, newPassword: 'ResetPassword789' });
    expect(reset.statusCode).toBe(200);
    expect(
      (await post('/auth/reset-password', { token, newPassword: 'Another1234567' })).statusCode,
    ).toBe(401);
    expect(
      (await login(app(), 'reset@example.com', { password: 'ResetPassword789' })).statusCode,
    ).toBe(200);
  });
});
