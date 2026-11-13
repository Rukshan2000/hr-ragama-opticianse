import { randomBytes } from 'node:crypto';
import {
  generateAuthenticationOptions,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { appConfig } from '../../config/app.config';
import { db, withTransaction, type DbExecutor } from '../../database/knex';
import { AppError, ConflictError, ForbiddenError } from '../../shared/errors/app-error';
import {
  decrypt,
  deriveKey,
  encrypt,
  generateNumericCode,
  generateToken,
  hashToken,
  safeEqual,
} from '../../shared/utils/crypto';
import { sendMfaCodeEmail } from '../../shared/utils/mailer';
import { base32Encode, generateTotpSecret, otpauthUrl, verifyTotp } from '../../shared/utils/totp';
import { authRepository } from './auth.repository';
import { authService } from './auth.service';
import type { ClientInfo } from './auth.types';
import { mfaRepository, type MfaColumn, type MfaUserRow } from './mfa.repository';
import { passkeyRepository } from './passkey.repository';
import { verifyAssertion } from './passkey.service';

export type MfaMethod = 'totp' | 'email' | 'passkey' | 'recovery';
export type MfaFactor = Exclude<MfaMethod, 'recovery'>;

const cfg = appConfig.mfa;
const secret = appConfig.auth.refreshSecret;
const totpKey = deriveKey(cfg.encryptionSecret, 'mfa-totp-secret');
const COLUMN: Record<MfaFactor, MfaColumn> = {
  totp: 'mfa_totp_enabled_at',
  email: 'mfa_email_enabled_at',
  passkey: 'mfa_passkey_enabled_at',
};
const RECOVERY_CODE_COUNT = 10;

const expired = () =>
  new AppError(401, 'Verification expired; please sign in again', 'MFA_EXPIRED');
const invalidCode = () => new AppError(401, 'Invalid verification code', 'MFA_INVALID');

const normalizeRecovery = (c: string) => c.toUpperCase().replace(/[^A-Z2-7]/g, '');
const hashRecovery = (c: string) => hashToken(normalizeRecovery(c), secret);
const hashEmailCode = (ticketId: string, code: string) => hashToken(`${ticketId}:${code}`, secret);

function enabledFactors(u: MfaUserRow, passkeyCount: number): MfaFactor[] {
  const out: MfaFactor[] = [];
  if (u.mfa_totp_enabled_at) out.push('totp');
  if (u.mfa_email_enabled_at) out.push('email');
  if (u.mfa_passkey_enabled_at && passkeyCount > 0) out.push('passkey');
  return out;
}

async function loadFactors(userId: string) {
  const [user, passkeys] = await Promise.all([
    mfaRepository.findUser(userId),
    passkeyRepository.listForUser(userId),
  ]);
  if (!user) throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
  return { user, passkeys, factors: enabledFactors(user, passkeys.length) };
}

/** Issued once when the first factor is turned on; shown to the user a single time. */
async function issueRecoveryCodes(userId: string, executor: DbExecutor) {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  await mfaRepository.replaceRecoveryCodes(userId, codes.map(hashRecovery), executor);
  return codes;
}

async function enableFactor(
  userId: string,
  factor: MfaFactor,
  extra: Record<string, unknown> = {},
) {
  return withTransaction(async (trx) => {
    const before = await mfaRepository.findUser(userId, trx);
    const hadAny = before && enabledFactors(before, Infinity).length > 0;
    await mfaRepository.update(userId, { [COLUMN[factor]]: trx.fn.now(), ...extra }, trx);
    return { recoveryCodes: hadAny ? undefined : await issueRecoveryCodes(userId, trx) };
  });
}

export const mfaService = {
  /** Called by password login. Returns a ticket when a second factor is required, else null. */
  async beginIfRequired(userId: string, tenantSlug: string | undefined) {
    const { factors } = await loadFactors(userId);
    if (!factors.length) return null;
    const mfaToken = generateToken();
    await mfaRepository.insertChallenge({
      user_id: userId,
      token_hash: hashToken(mfaToken, secret),
      tenant_slug: tenantSlug ?? null,
      expires_at: new Date(Date.now() + cfg.tokenTtlMs),
    });
    const recovery = (await mfaRepository.countRecoveryCodes(userId)) > 0;
    return {
      mfaRequired: true as const,
      mfaToken,
      methods: [...factors, ...(recovery ? (['recovery'] as const) : [])],
    };
  },

  async sendEmailCode(mfaToken: string) {
    const sent = await withTransaction(async (trx) => {
      const row = await mfaRepository.findChallengeForUpdate(hashToken(mfaToken, secret), trx);
      if (!row || row.expires_at <= new Date()) throw expired();
      const user = await mfaRepository.findUser(row.user_id, trx);
      if (!user?.mfa_email_enabled_at)
        throw new ForbiddenError('Email verification is not enabled');
      if (row.email_sent_at && Date.now() - row.email_sent_at.getTime() < cfg.emailResendMs) {
        throw new AppError(429, 'Please wait before requesting another code', 'TOO_MANY_REQUESTS');
      }
      const code = generateNumericCode();
      await mfaRepository.updateChallenge(
        row.id,
        { email_code_hash: hashEmailCode(row.id, code), email_sent_at: new Date() },
        trx,
      );
      return { to: user.email, code };
    });
    await sendMfaCodeEmail(sent.to, sent.code);
  },

  async passkeyOptions(mfaToken: string) {
    return withTransaction(async (trx) => {
      const row = await mfaRepository.findChallengeForUpdate(hashToken(mfaToken, secret), trx);
      if (!row || row.expires_at <= new Date()) throw expired();
      const { user, passkeys } = await loadFactors(row.user_id);
      if (!user.mfa_passkey_enabled_at || !passkeys.length)
        throw new ForbiddenError('Passkey verification is not enabled');
      const options = await generateAuthenticationOptions({
        rpID: appConfig.passkeys.rpId,
        allowCredentials: passkeys.map((p) => ({ id: p.credential_id, transports: p.transports })),
        userVerification: appConfig.passkeys.userVerification,
        timeout: appConfig.passkeys.challengeTtlMs,
      });
      await mfaRepository.updateChallenge(row.id, { passkey_challenge: options.challenge }, trx);
      return options;
    });
  },

  /**
   * Completes a login. Attempts are counted per ticket and committed even on failure; after
   * `maxAttempts` the ticket is destroyed and the password must be entered again.
   */
  async verify(
    input: {
      mfaToken: string;
      method: MfaMethod;
      code?: string;
      response?: AuthenticationResponseJSON;
    },
    client: ClientInfo,
  ) {
    const result = await withTransaction(async (trx) => {
      const row = await mfaRepository.findChallengeForUpdate(
        hashToken(input.mfaToken, secret),
        trx,
      );
      if (!row || row.expires_at <= new Date() || row.attempts >= cfg.maxAttempts) {
        if (row) await mfaRepository.deleteChallenge(row.id, trx);
        return { error: 'expired' as const };
      }
      const user = await mfaRepository.findUser(row.user_id, trx);
      let ok = false;
      if (user) ok = await checkFactor(user, row, input, trx);

      if (!ok) {
        if (row.attempts + 1 >= cfg.maxAttempts) await mfaRepository.deleteChallenge(row.id, trx);
        else await mfaRepository.updateChallenge(row.id, { attempts: row.attempts + 1 }, trx);
        return { error: 'invalid' as const };
      }
      await mfaRepository.deleteChallenge(row.id, trx);
      return { userId: row.user_id, tenantSlug: row.tenant_slug ?? undefined };
    });

    if ('error' in result) throw result.error === 'expired' ? expired() : invalidCode();
    const user = await authRepository.findCredentialsById(result.userId);
    if (!user?.is_active) throw new ForbiddenError('Account is deactivated');
    const session = await authService.startSession(user, result.tenantSlug, client);
    return { session, userId: user.id };
  },

  // ---- Authenticated management ----

  async status(userId: string) {
    const { user, passkeys, factors } = await loadFactors(userId);
    return {
      enabled: factors.length > 0,
      totp: !!user.mfa_totp_enabled_at,
      email: !!user.mfa_email_enabled_at,
      passkey: !!user.mfa_passkey_enabled_at,
      passkeyCount: passkeys.length,
      recoveryCodesRemaining: await mfaRepository.countRecoveryCodes(userId),
    };
  },

  /** Stores a pending secret; it becomes active only after a valid code proves the app has it. */
  async totpSetup(userId: string, currentPassword: string) {
    const user = await authService.verifyCurrentPassword(userId, currentPassword);
    const mfa = await mfaRepository.findUser(userId);
    if (mfa?.mfa_totp_enabled_at) throw new ConflictError('Authenticator app is already enabled');
    const totpSecret = generateTotpSecret();
    await mfaRepository.update(userId, {
      mfa_totp_secret: encrypt(totpSecret, totpKey),
      mfa_totp_last_step: null,
    });
    return { secret: totpSecret, otpauthUrl: otpauthUrl(cfg.issuer, user.email, totpSecret) };
  },

  async totpEnable(userId: string, code: string) {
    const user = await mfaRepository.findUser(userId);
    if (!user?.mfa_totp_secret)
      throw new AppError(400, 'Start authenticator setup first', 'BAD_REQUEST');
    if (user.mfa_totp_enabled_at) throw new ConflictError('Authenticator app is already enabled');
    const step = verifyTotp(decrypt(user.mfa_totp_secret, totpKey), code);
    if (step === null) throw invalidCode();
    return enableFactor(userId, 'totp', { mfa_totp_last_step: step });
  },

  async enable(userId: string, factor: 'email' | 'passkey', currentPassword: string) {
    await authService.verifyCurrentPassword(userId, currentPassword);
    const { user, passkeys } = await loadFactors(userId);
    if (user[COLUMN[factor]]) throw new ConflictError('Already enabled');
    if (factor === 'passkey' && !passkeys.length)
      throw new AppError(400, 'Add a passkey first', 'BAD_REQUEST');
    return enableFactor(userId, factor);
  },

  async disable(userId: string, factor: MfaFactor, currentPassword: string) {
    await authService.verifyCurrentPassword(userId, currentPassword);
    await withTransaction(async (trx) => {
      const patch: Record<string, unknown> = { [COLUMN[factor]]: null };
      if (factor === 'totp')
        Object.assign(patch, { mfa_totp_secret: null, mfa_totp_last_step: null });
      await mfaRepository.update(userId, patch, trx);
      const after = await mfaRepository.findUser(userId, trx);
      if (after && !enabledFactors(after, Infinity).length)
        await mfaRepository.replaceRecoveryCodes(userId, [], trx);
    });
  },

  async regenerateRecoveryCodes(userId: string, currentPassword: string) {
    await authService.verifyCurrentPassword(userId, currentPassword);
    const { factors } = await loadFactors(userId);
    if (!factors.length)
      throw new AppError(400, 'Turn on 2-step verification first', 'BAD_REQUEST');
    return { recoveryCodes: await db.transaction((trx) => issueRecoveryCodes(userId, trx)) };
  },
};

async function checkFactor(
  user: MfaUserRow,
  row: {
    id: string;
    email_code_hash: string | null;
    passkey_challenge: string | null;
    user_id: string;
  },
  input: { method: MfaMethod; code?: string; response?: AuthenticationResponseJSON },
  trx: DbExecutor,
): Promise<boolean> {
  const code = input.code?.trim() ?? '';
  switch (input.method) {
    case 'totp': {
      if (!user.mfa_totp_enabled_at || !user.mfa_totp_secret || !/^\d{6}$/.test(code)) return false;
      const last = user.mfa_totp_last_step === null ? -1 : Number(user.mfa_totp_last_step);
      const step = verifyTotp(decrypt(user.mfa_totp_secret, totpKey), code, last);
      return step !== null && mfaRepository.advanceTotpStep(user.id, step, trx);
    }
    case 'email':
      return (
        !!user.mfa_email_enabled_at &&
        !!row.email_code_hash &&
        /^\d{6}$/.test(code) &&
        safeEqual(row.email_code_hash, hashEmailCode(row.id, code))
      );
    case 'recovery':
      return code.length > 0 && mfaRepository.useRecoveryCode(user.id, hashRecovery(code), trx);
    case 'passkey': {
      if (!user.mfa_passkey_enabled_at || !row.passkey_challenge || !input.response) return false;
      const passkey = await passkeyRepository.findByCredentialId(input.response.id);
      if (!passkey || passkey.user_id !== row.user_id) return false;
      try {
        await verifyAssertion(passkey, input.response, row.passkey_challenge);
        return true;
      } catch {
        return false;
      }
    }
  }
}
