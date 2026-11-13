import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/knex';
import { SoftAuthenticator, type Ceremony } from '../helpers/soft-authenticator';
import { API, PASSWORD, bearer, register, setupTestApp, type Session } from '../helpers/test-app';

const app = setupTestApp();
const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
  s?: Session,
) =>
  app().inject({ method, url: `${API}/auth/passkeys${url}`, payload, headers: s ? bearer(s) : {} });

async function addPasskey(s: Session, key = new SoftAuthenticator(), c: Ceremony = {}) {
  const { challengeId, options } = (await call('POST', '/register/options', {}, s)).json().data;
  const res = await call(
    'POST',
    '/register/verify',
    { challengeId, response: key.register(options, c) },
    s,
  );
  return { key, res, options };
}

async function passkeyLogin(
  key: SoftAuthenticator,
  c: Ceremony & { tamper?: boolean; email?: string } = {},
) {
  const { challengeId, options } = (await call('POST', '/login/options', { email: c.email })).json()
    .data;
  return call('POST', '/login/verify', { challengeId, response: key.login(options, c) });
}

describe('passkey registration', () => {
  it('registers a passkey and excludes it on the next options call', async () => {
    const s = await register(app(), 'reg@example.com');
    const { key, res } = await addPasskey(s);
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ deviceType: 'singleDevice', transports: ['internal'] });
    expect(res.body).not.toMatch(/public_?key/i);

    const next = (await call('POST', '/register/options', {}, s)).json().data.options;
    expect(next.excludeCredentials.map((c: { id: string }) => c.id)).toEqual([key.id]);
  });

  it('rejects a duplicate credential', async () => {
    const s = await register(app(), 'dup@example.com');
    const { key } = await addPasskey(s);
    const again = await addPasskey(s, key);
    expect(again.res.statusCode).toBe(409);
    expect(again.res.json().message).toMatch(/already registered/);
  });

  it.each([
    ['wrong origin', { origin: 'https://evil.example' }],
    ['wrong RP ID', { rpId: 'evil.example' }],
    ['challenge mismatch', { challenge: 'bm90LXRoZS1jaGFsbGVuZ2U' }],
    ['missing user verification', { uv: false }],
  ])('rejects %s', async (_n, c) => {
    const s = await register(app(), 'bad@example.com');
    expect((await addPasskey(s, undefined, c)).res.statusCode).toBe(400);
  });

  it('rejects a challenge issued to another user', async () => {
    const a = await register(app(), 'a@example.com');
    const b = await register(app(), 'b@example.com');
    const { challengeId, options } = (await call('POST', '/register/options', {}, a)).json().data;
    const res = await call(
      'POST',
      '/register/verify',
      { challengeId, response: new SoftAuthenticator().register(options) },
      b,
    );
    expect(res.statusCode).toBe(400);
  });

  it('requires authentication', async () => {
    expect((await call('POST', '/register/options', {})).statusCode).toBe(401);
    expect((await call('GET', '/')).statusCode).toBe(401);
  });
});

describe('passkey login', () => {
  it('logs in with a discoverable credential and with email, updating the counter', async () => {
    const s = await register(app(), 'login@example.com');
    const { key } = await addPasskey(s);

    const res = await passkeyLogin(key);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      user: { email: 'login@example.com' },
      tokenType: 'Bearer',
    });
    const me = await app().inject({
      url: `${API}/auth/me`,
      headers: bearer(res.json().data.accessToken),
    });
    expect(me.statusCode).toBe(200);

    const byEmail = await passkeyLogin(key, { email: 'login@example.com' });
    expect(byEmail.statusCode).toBe(200);
    const row = await db('user_passkeys').where({ credential_id: key.id }).first();
    expect(Number(row.counter)).toBe(3);
    expect(row.last_used_at).not.toBeNull();
  });

  it('scopes email login to that user and does not reveal unknown emails', async () => {
    await register(app(), 'owner@example.com');
    const other = await register(app(), 'other@example.com');
    const { key } = await addPasskey(other);
    const scoped = (await call('POST', '/login/options', { email: 'owner@example.com' })).json()
      .data;
    const unknown = (await call('POST', '/login/options', { email: 'ghost@example.com' })).json()
      .data;
    expect(scoped.options.allowCredentials).toBeUndefined(); // owner has no passkeys
    expect(unknown.options.allowCredentials).toBeUndefined();

    const withOther = await passkeyLogin(key, { email: 'other@example.com' });
    expect(withOther.statusCode).toBe(200);
  });

  it('rejects an invalid signature', async () => {
    const s = await register(app(), 'sig@example.com');
    const { key } = await addPasskey(s);
    expect((await passkeyLogin(key, { tamper: true })).statusCode).toBe(401);
  });

  it.each([
    ['wrong origin', { origin: 'https://evil.example' }],
    ['wrong RP ID', { rpId: 'evil.example' }],
    ['challenge mismatch', { challenge: 'bm90LXRoZS1jaGFsbGVuZ2U' }],
  ])('rejects %s', async (_n, c) => {
    const s = await register(app(), 'lbad@example.com');
    const { key } = await addPasskey(s);
    expect((await passkeyLogin(key, c)).statusCode).toBe(401);
  });

  it('rejects an unknown credential', async () => {
    expect((await passkeyLogin(new SoftAuthenticator())).statusCode).toBe(401);
  });

  it('rejects expired and replayed challenges', async () => {
    const s = await register(app(), 'replay@example.com');
    const { key } = await addPasskey(s);

    const expired = (await call('POST', '/login/options', {})).json().data;
    await db('passkey_challenges')
      .where({ id: expired.challengeId })
      .update({ expires_at: new Date(0) });
    const r1 = await call('POST', '/login/verify', {
      challengeId: expired.challengeId,
      response: key.login(expired.options),
    });
    expect(r1.statusCode).toBe(400);
    expect(r1.json().message).toMatch(/expired or invalid/);

    const fresh = (await call('POST', '/login/options', {})).json().data;
    const response = key.login(fresh.options);
    expect(
      (await call('POST', '/login/verify', { challengeId: fresh.challengeId, response }))
        .statusCode,
    ).toBe(200);
    const replay = await call('POST', '/login/verify', {
      challengeId: fresh.challengeId,
      response,
    });
    expect(replay.statusCode).toBe(400);
  });

  it('rejects a deactivated user', async () => {
    const s = await register(app(), 'off@example.com');
    const { key } = await addPasskey(s);
    await db('users').where({ id: s.userId }).update({ is_active: false });
    expect((await passkeyLogin(key)).statusCode).toBe(403);
  });

  it('keeps concurrent attempts isolated', async () => {
    const s = await register(app(), 'conc@example.com');
    const { key } = await addPasskey(s);
    const [a, b] = await Promise.all([
      call('POST', '/login/options', {}).then((r) => r.json().data),
      call('POST', '/login/options', {}).then((r) => r.json().data),
    ]);
    expect(a.challengeId).not.toBe(b.challengeId);
    // Sign sequentially so the authenticator counter stays monotonic, then verify in parallel.
    const ra = key.login(a.options);
    const rb = key.login(b.options);
    const results = await Promise.all([
      call('POST', '/login/verify', { challengeId: b.challengeId, response: rb }),
      call('POST', '/login/verify', { challengeId: a.challengeId, response: ra }),
    ]);
    // b carries the higher counter; a may then fail as a counter regression, never via challenge mix-up.
    expect(results[0].statusCode).toBe(200);
    // Cross-using a challenge is rejected.
    const c = (await call('POST', '/login/options', {})).json().data;
    const d = (await call('POST', '/login/options', {})).json().data;
    const cross = await call('POST', '/login/verify', {
      challengeId: d.challengeId,
      response: key.login(c.options),
    });
    expect(cross.statusCode).toBe(401);
  });
});

describe('passkey management', () => {
  it('lists, renames and removes (with re-auth) only own passkeys', async () => {
    const s = await register(app(), 'mgr@example.com');
    const intruder = await register(app(), 'intruder@example.com');
    await addPasskey(s);
    const [pk] = (await call('GET', '/', undefined, s)).json().data;
    expect(pk).toMatchObject({ deviceName: null, lastUsedAt: null });

    const renamed = await call('PATCH', `/${pk.id}`, { deviceName: 'MacBook' }, s);
    expect(renamed.json().data.deviceName).toBe('MacBook');
    expect((await call('PATCH', `/${pk.id}`, { deviceName: 'x' }, intruder)).statusCode).toBe(404);
    expect(
      (await call('DELETE', `/${pk.id}`, { currentPassword: PASSWORD }, intruder)).statusCode,
    ).toBe(404);

    expect(
      (await call('DELETE', `/${pk.id}`, { currentPassword: 'WrongPass123' }, s)).statusCode,
    ).toBe(401);
    expect((await call('DELETE', `/${pk.id}`, { currentPassword: PASSWORD }, s)).statusCode).toBe(
      200,
    );
    expect((await call('GET', '/', undefined, s)).json().data).toEqual([]);
  });
});
