import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { API, bearer, register, setupTestApp } from '../helpers/test-app';

const app = setupTestApp();
const KEY = readFileSync(`${__dirname}/../helpers/hub-test-key.pem`, 'utf8');

function token(claims: object, opts: jwt.SignOptions = {}) {
  return jwt.sign({ sub: randomUUID(), org: randomUUID(), typ: 'launch', ...claims }, KEY, {
    algorithm: 'RS256',
    issuer: 'invohub',
    audience: 'invoteam',
    expiresIn: 60,
    jwtid: randomUUID(),
    ...opts,
  });
}
const hub = (t: string) =>
  app().inject({ method: 'POST', url: `${API}/auth/hub`, payload: { token: t } });

describe('InvoHub sign-in (/auth/hub)', () => {
  it('starts a session in the tenant the hub names, once', async () => {
    const s = await register(app(), 'hub@a.com');
    const t = token({ email: 'HUB@a.com', ext_tenant: s.tenantId });
    const res = await hub(t);
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.tenant.id).toBe(s.tenantId);
    const me = await app().inject({
      method: 'GET',
      url: `${API}/auth/me`,
      headers: bearer(data.accessToken),
    });
    expect(me.json().data.email).toBe('hub@a.com');

    expect((await hub(t)).statusCode).toBe(401); // replay
  });

  it('rejects expired, wrong-audience, wrongly signed and foreign-issuer tokens', async () => {
    const s = await register(app(), 'hub2@a.com');
    const c = { email: 'hub2@a.com', ext_tenant: s.tenantId };
    expect((await hub(token(c, { expiresIn: -10 }))).statusCode).toBe(401);
    expect((await hub(token(c, { audience: 'someone-else' }))).statusCode).toBe(401);
    expect((await hub(token(c, { issuer: 'evil' }))).statusCode).toBe(401);
    const forged = jwt.sign(c, 'not-the-hub-key-not-the-hub-key-123', {
      audience: 'invoteam',
      issuer: 'invohub',
      jwtid: randomUUID(),
    });
    expect((await hub(forged)).statusCode).toBe(401);
  });

  it('refuses unknown users and tenants the user is not a member of', async () => {
    const a = await register(app(), 'hub3@a.com');
    const b = await register(app(), 'hub4@b.com');
    const unknown = await hub(token({ email: 'nobody@a.com', ext_tenant: a.tenantId }));
    expect(unknown.statusCode).toBe(403);
    expect(unknown.json().message).toMatch(/don't have access/);
    expect((await hub(token({ email: 'hub3@a.com', ext_tenant: b.tenantId }))).statusCode).toBe(
      403,
    );
    expect((await hub(token({ email: 'hub3@a.com' }))).statusCode).toBe(403);
  });

  it("single logout ends the user's sessions; token types are not interchangeable", async () => {
    const s = await register(app(), 'out@a.com');
    const launch = token({ email: 'out@a.com', ext_tenant: s.tenantId });
    const logout = (t: string) =>
      app().inject({ method: 'POST', url: `${API}/auth/hub/logout`, payload: { token: t } });

    expect((await logout(launch)).statusCode).toBe(401); // a sign-in token can't sign out
    expect(
      (await hub(token({ email: 'out@a.com', ext_tenant: s.tenantId, typ: 'logout' }))).statusCode,
    ).toBe(401);

    expect((await logout(token({ email: 'OUT@a.com', typ: 'logout' }))).statusCode).toBe(200);
    const refresh = await app().inject({
      method: 'POST',
      url: `${API}/auth/refresh`,
      payload: { refreshToken: s.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);
    expect((await logout(token({ email: 'nobody@a.com', typ: 'logout' }))).statusCode).toBe(200);
  });
});
