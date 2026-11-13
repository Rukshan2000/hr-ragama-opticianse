import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/shared/utils/mailer', () => ({
  sendPasswordResetEmail: vi.fn(),
  sendMfaCodeEmail: vi.fn(),
}));

import { db } from '../../src/database/knex';
import { sendMfaCodeEmail } from '../../src/shared/utils/mailer';
import { currentStep, totpAt } from '../../src/shared/utils/totp';
import { SoftAuthenticator } from '../helpers/soft-authenticator';
import {
  API,
  PASSWORD,
  bearer,
  login,
  register,
  setupTestApp,
  type Session,
} from '../helpers/test-app';

const app = setupTestApp();
const call = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object, s?: Session) =>
  app().inject({ method, url: `${API}/auth${url}`, payload, headers: s ? bearer(s) : {} });
const pw = { currentPassword: PASSWORD };

async function enableTotp(s: Session) {
  const { secret } = (await call('POST', '/mfa/totp/setup', pw, s)).json().data;
  const res = await call('POST', '/mfa/totp/enable', { code: totpAt(secret, currentStep()) }, s);
  // Mark the current step used so later logins need a different one (replay protection).
  return { secret, res };
}

async function ticket(email: string) {
  const res = await login(app(), email);
  expect(res.statusCode).toBe(200);
  return res.json().data as { mfaRequired: true; mfaToken: string; methods: string[] };
}

describe('authenticator app (TOTP)', () => {
  it('requires a proven code to enable, then gates login and blocks code reuse', async () => {
    const s = await register(app(), 'totp@example.com');
    expect(
      (await call('POST', '/mfa/totp/setup', { currentPassword: 'WrongPass123' }, s)).statusCode,
    ).toBe(401);

    const { secret } = (await call('POST', '/mfa/totp/setup', pw, s)).json().data;
    expect((await call('POST', '/mfa/totp/enable', { code: '000000' }, s)).statusCode).toBe(401);
    const enabled = await call(
      'POST',
      '/mfa/totp/enable',
      { code: totpAt(secret, currentStep() - 1) },
      s,
    );
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().data.recoveryCodes).toHaveLength(10);
    const stored = await db('users').where({ id: s.userId }).first('mfa_totp_secret');
    expect(stored.mfa_totp_secret).not.toContain(secret); // encrypted at rest

    const t = await ticket('totp@example.com');
    expect(t).toMatchObject({ mfaRequired: true, methods: ['totp', 'recovery'] });
    expect(t).not.toHaveProperty('accessToken');

    expect(
      (await call('POST', '/mfa/verify', { mfaToken: t.mfaToken, method: 'totp', code: '123456' }))
        .statusCode,
    ).toBe(401);
    const code = totpAt(secret, currentStep());
    const ok = await call('POST', '/mfa/verify', { mfaToken: t.mfaToken, method: 'totp', code });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.accessToken).toBeTruthy();

    // Ticket is single-use, and the same code can't be replayed on a new ticket.
    expect(
      (await call('POST', '/mfa/verify', { mfaToken: t.mfaToken, method: 'totp', code }))
        .statusCode,
    ).toBe(401);
    const t2 = await ticket('totp@example.com');
    expect(
      (await call('POST', '/mfa/verify', { mfaToken: t2.mfaToken, method: 'totp', code }))
        .statusCode,
    ).toBe(401);
  });

  it('destroys the ticket after too many wrong codes', async () => {
    const s = await register(app(), 'brute@example.com');
    const { secret } = await enableTotp(s);
    const t = await ticket('brute@example.com');
    for (let i = 0; i < 5; i++)
      await call('POST', '/mfa/verify', { mfaToken: t.mfaToken, method: 'totp', code: '000000' });
    const late = await call('POST', '/mfa/verify', {
      mfaToken: t.mfaToken,
      method: 'totp',
      code: totpAt(secret, currentStep() + 1),
    });
    expect(late.statusCode).toBe(401);
    expect(late.json().message).toMatch(/expired/);
  });

  it('rejects an expired ticket', async () => {
    const s = await register(app(), 'exp@example.com');
    const { secret } = await enableTotp(s);
    const t = await ticket('exp@example.com');
    await db('mfa_challenges').update({ expires_at: new Date(0) });
    const res = await call('POST', '/mfa/verify', {
      mfaToken: t.mfaToken,
      method: 'totp',
      code: totpAt(secret, currentStep() + 1),
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('email codes and recovery codes', () => {
  it('emails a code, throttles resends and accepts the code once', async () => {
    const s = await register(app(), 'mail@example.com');
    const en = await call('POST', '/mfa/email/enable', pw, s);
    expect(en.json().data.recoveryCodes).toHaveLength(10);

    const t = await ticket('mail@example.com');
    expect((await call('POST', '/mfa/challenge/email', { mfaToken: t.mfaToken })).statusCode).toBe(
      200,
    );
    expect((await call('POST', '/mfa/challenge/email', { mfaToken: t.mfaToken })).statusCode).toBe(
      429,
    );
    const code = vi.mocked(sendMfaCodeEmail).mock.calls.at(-1)![1];
    expect(code).toMatch(/^\d{6}$/);
    expect(
      (await call('POST', '/mfa/verify', { mfaToken: t.mfaToken, method: 'email', code }))
        .statusCode,
    ).toBe(200);
  });

  it('accepts each recovery code once', async () => {
    const s = await register(app(), 'rec@example.com');
    const [code] = (await call('POST', '/mfa/email/enable', pw, s)).json().data.recoveryCodes;
    const t1 = await ticket('rec@example.com');
    const lower = code.toLowerCase().replace('-', ' ');
    expect(
      (
        await call('POST', '/mfa/verify', {
          mfaToken: t1.mfaToken,
          method: 'recovery',
          code: lower,
        })
      ).statusCode,
    ).toBe(200);
    const t2 = await ticket('rec@example.com');
    expect(
      (await call('POST', '/mfa/verify', { mfaToken: t2.mfaToken, method: 'recovery', code }))
        .statusCode,
    ).toBe(401);
    expect((await call('GET', '/mfa', undefined, s)).json().data.recoveryCodesRemaining).toBe(9);
  });

  it('rejects a method the user has not enabled', async () => {
    await register(app(), 'only@example.com');
    const s = (await login(app(), 'only@example.com')).json().data;
    await call('POST', '/mfa/email/enable', pw, { accessToken: s.accessToken } as Session);
    const t = await ticket('only@example.com');
    const res = await call('POST', '/mfa/verify', {
      mfaToken: t.mfaToken,
      method: 'totp',
      code: '123456',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('passkey as second factor', () => {
  it('verifies with a passkey, keeps passkey login single-step and protects the last passkey', async () => {
    const s = await register(app(), 'pk2@example.com');
    expect((await call('POST', '/mfa/passkey/enable', pw, s)).statusCode).toBe(400); // no passkey yet

    const key = new SoftAuthenticator();
    const reg = (await call('POST', '/passkeys/register/options', {}, s)).json().data;
    await call(
      'POST',
      '/passkeys/register/verify',
      { challengeId: reg.challengeId, response: key.register(reg.options) },
      s,
    );
    expect((await call('POST', '/mfa/passkey/enable', pw, s)).statusCode).toBe(200);

    const t = await ticket('pk2@example.com');
    expect(t.methods).toContain('passkey');
    const options = (await call('POST', '/mfa/challenge/passkey', { mfaToken: t.mfaToken })).json()
      .data;
    expect(options.allowCredentials.map((c: { id: string }) => c.id)).toEqual([key.id]);
    const ok = await call('POST', '/mfa/verify', {
      mfaToken: t.mfaToken,
      method: 'passkey',
      response: key.login(options),
    });
    expect(ok.statusCode).toBe(200);

    const lo = (await call('POST', '/passkeys/login/options', {})).json().data;
    const direct = await call('POST', '/passkeys/login/verify', {
      challengeId: lo.challengeId,
      response: key.login(lo.options),
    });
    expect(direct.json().data.accessToken).toBeTruthy();

    const [pk] = (await call('GET', '/passkeys', undefined, s)).json().data;
    expect((await call('DELETE', `/passkeys/${pk.id}`, pw, s)).statusCode).toBe(409);
  });
});

describe('management', () => {
  it('disabling the last factor restores normal login and clears recovery codes', async () => {
    const s = await register(app(), 'off@example.com');
    await call('POST', '/mfa/email/enable', pw, s);
    expect((await call('POST', '/mfa/email/disable', pw, s)).statusCode).toBe(200);
    expect((await login(app(), 'off@example.com')).json().data.accessToken).toBeTruthy();
    expect(await db('mfa_recovery_codes').where({ user_id: s.userId })).toHaveLength(0);
  });

  it('regenerates recovery codes and requires auth', async () => {
    const s = await register(app(), 'regen@example.com');
    expect((await call('POST', '/mfa/recovery-codes', pw, s)).statusCode).toBe(400);
    await call('POST', '/mfa/email/enable', pw, s);
    expect(
      (await call('POST', '/mfa/recovery-codes', pw, s)).json().data.recoveryCodes,
    ).toHaveLength(10);
    expect((await call('GET', '/mfa')).statusCode).toBe(401);
  });
});
