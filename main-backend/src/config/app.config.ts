import { env } from './env';
import { parseDurationMs } from '../shared/utils/duration';

/** Fails startup on a misconfigured relying party: origins must be explicit and match RP_ID. */
export function parsePasskeyOrigins(raw: string, rpId: string, production: boolean): string[] {
  return raw.split(',').map((o) => {
    const url = new URL(o.trim());
    if (url.origin !== o.trim()) throw new Error(`EXPECTED_ORIGIN "${o}" must be a bare origin`);
    if (production && url.protocol !== 'https:')
      throw new Error(`EXPECTED_ORIGIN "${o}" must use https in production`);
    const host = url.hostname;
    if (host !== rpId && !host.endsWith(`.${rpId}`))
      throw new Error(`RP_ID "${rpId}" is not a suffix of EXPECTED_ORIGIN host "${host}"`);
    return url.origin;
  });
}

export const appConfig = {
  name: env.APP_NAME,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  apiPrefix: env.API_PREFIX,
  swaggerEnabled: env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production',
  corsOrigins: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
  tenancy: {
    single: env.TENANCY_MODE === 'single',
    defaultName: env.DEFAULT_TENANT_NAME,
    defaultSlug: env.DEFAULT_TENANT_SLUG,
  },
  auth: {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessTtlMs: parseDurationMs(env.JWT_ACCESS_EXPIRES_IN),
    refreshTtlMs: parseDurationMs(env.JWT_REFRESH_EXPIRES_IN),
    passwordResetTtlMs: parseDurationMs(env.PASSWORD_RESET_EXPIRES_IN),
    maxLoginAttempts: env.LOGIN_MAX_ATTEMPTS,
    lockoutMs: env.LOGIN_LOCKOUT_MINUTES * 60_000,
  },
  mfa: {
    issuer: env.APP_NAME,
    encryptionSecret: env.MFA_ENCRYPTION_KEY ?? env.JWT_REFRESH_SECRET,
    tokenTtlMs: env.MFA_TOKEN_TTL * 1000,
    maxAttempts: 5,
    emailResendMs: 30_000,
  },
  passkeys: {
    rpName: env.RP_NAME ?? env.APP_NAME,
    rpId: env.RP_ID,
    origins: parsePasskeyOrigins(env.EXPECTED_ORIGIN, env.RP_ID, env.NODE_ENV === 'production'),
    challengeTtlMs: env.PASSKEY_CHALLENGE_TTL * 1000,
    requireUserVerification: env.PASSKEY_USER_VERIFICATION === 'required',
    userVerification: env.PASSKEY_USER_VERIFICATION,
  },
} as const;
