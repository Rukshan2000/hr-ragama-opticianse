import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { appConfig } from '../../config/app.config';
import { db, type DbExecutor } from '../../database/knex';
import { UnauthorizedError } from '../../shared/errors/app-error';
import type { AccessTokenPayload } from '../../shared/types/auth';
import { generateToken, hashToken } from '../../shared/utils/crypto';
import { authRepository } from './auth.repository';
import type { AuthTokens, ClientInfo } from './auth.types';

const { accessSecret, refreshSecret, accessTtlMs, refreshTtlMs } = appConfig.auth;
const JWT_OPTIONS = { algorithm: 'HS256', issuer: appConfig.name, audience: 'api' } as const;

export function signAccessToken(userId: string, tenantId: string | null): string {
  const payload: Omit<AccessTokenPayload, 'sub'> = { tid: tenantId, typ: 'access' };
  return jwt.sign(payload, accessSecret, {
    ...JWT_OPTIONS,
    subject: userId,
    expiresIn: Math.floor(accessTtlMs / 1000),
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload & { iat: number } {
  try {
    const decoded = jwt.verify(token, accessSecret, {
      algorithms: [JWT_OPTIONS.algorithm],
      issuer: JWT_OPTIONS.issuer,
      audience: JWT_OPTIONS.audience,
    });
    if (typeof decoded === 'string' || decoded.typ !== 'access' || !decoded.sub || !decoded.iat) {
      throw new Error('Malformed token');
    }
    return decoded as AccessTokenPayload & { iat: number };
  } catch {
    throw new UnauthorizedError('Invalid or expired access token');
  }
}

export function hashRefreshToken(token: string): string {
  return hashToken(token, refreshSecret);
}

/** Issues an access token plus a new refresh token in `familyId` (new family = new session). */
export async function issueTokens(
  userId: string,
  tenantId: string | null,
  client: ClientInfo,
  { familyId = randomUUID() as string, executor = db as DbExecutor } = {},
): Promise<AuthTokens & { refreshTokenId: string }> {
  const refreshToken = generateToken();
  const refreshTokenId = await authRepository.insertRefreshToken(
    {
      user_id: userId,
      tenant_id: tenantId,
      family_id: familyId,
      token_hash: hashRefreshToken(refreshToken),
      expires_at: new Date(Date.now() + refreshTtlMs),
      ip: client.ip?.slice(0, 64),
      user_agent: client.userAgent?.slice(0, 255),
    },
    executor,
  );
  return {
    accessToken: signAccessToken(userId, tenantId),
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: Math.floor(accessTtlMs / 1000),
    refreshTokenId,
  };
}
