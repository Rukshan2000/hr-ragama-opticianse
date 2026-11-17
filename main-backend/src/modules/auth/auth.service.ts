import { appConfig } from '../../config/app.config';
import { db, withTransaction } from '../../database/knex';
import {
  ForbiddenError,
  TooManyRequestsError,
  UnauthorizedError,
} from '../../shared/errors/app-error';
import { generateToken, hashToken } from '../../shared/utils/crypto';
import { sendPasswordResetEmail } from '../../shared/utils/mailer';
import { getDummyHash, hashPassword, verifyPassword } from '../../shared/utils/password';
import { createTenantWithDefaults, joinDefaultTenant } from '../tenants/tenants.service';
import { usersRepository } from '../users/users.repository';
import { authRepository } from './auth.repository';
import { isHubManaged } from './hub-sync';
import { mfaService } from './mfa.service';
import type { ClientInfo, TenantSummary } from './auth.types';
import { hashRefreshToken, issueTokens } from './token.service';

const { maxLoginAttempts, lockoutMs, passwordResetTtlMs, refreshSecret } = appConfig.auth;

async function sessionResponse(
  user: { id: string; name: string; email: string },
  tenant: TenantSummary | null,
  client: ClientInfo,
  tenants?: TenantSummary[],
) {
  const { refreshTokenId: _id, ...tokens } = await issueTokens(user.id, tenant?.id ?? null, client);
  return {
    ...tokens,
    user: { id: user.id, name: user.name, email: user.email },
    tenant,
    tenants: tenants ?? (await authRepository.findActiveTenantsForUser(user.id)),
  };
}

export const authService = {
  /** Self-service signup: creates the user and their organization (tenant), user becomes its Admin. */
  async register(
    input: { name: string; email: string; password: string; organizationName?: string },
    client: ClientInfo,
  ) {
    const passwordHash = await hashPassword(input.password);
    const { userId, tenant } = await withTransaction(async (trx) => {
      const userId = await usersRepository.insertUser(
        { name: input.name, email: input.email, password_hash: passwordHash },
        trx,
      );
      const tenant = appConfig.tenancy.single
        ? await joinDefaultTenant(trx, userId)
        : await createTenantWithDefaults(trx, {
            name: input.organizationName!,
            ownerUserId: userId,
          });
      return { userId, tenant };
    });
    const t = { id: tenant.id, name: tenant.name, slug: tenant.slug };
    return sessionResponse({ id: userId, name: input.name, email: input.email }, t, client, [t]);
  },

  /**
   * Tenant selection: explicit `tenantSlug` must match an active membership. Without it, a user
   * with exactly one tenant is logged into it; otherwise they get a platform-context session and
   * pick a tenant with /auth/switch-tenant.
   */
  async login(input: { email: string; password: string; tenantSlug?: string }, client: ClientInfo) {
    const user = await authRepository.findCredentialsByEmail(input.email);
    if (!user) {
      await verifyPassword(await getDummyHash(), input.password); // equalize timing
      throw new UnauthorizedError('Invalid email or password');
    }
    if (user.locked_until && user.locked_until > new Date()) {
      throw new TooManyRequestsError('Account temporarily locked due to failed login attempts');
    }
    if (!(await verifyPassword(user.password_hash, input.password))) {
      await authRepository.recordFailedLogin(user.id, maxLoginAttempts, lockoutMs);
      throw new UnauthorizedError('Invalid email or password');
    }
    if (!user.is_active) throw new ForbiddenError('Account is deactivated');
    // Second factor pending: no tokens yet, only a short-lived MFA ticket.
    const mfa = await mfaService.beginIfRequired(user.id, input.tenantSlug);
    if (mfa) {
      await authRepository.resetFailedLogins(user.id); // password was right
      return mfa;
    }
    return authService.startSession(user, input.tenantSlug, client);
  },

  /** Shared by every login method once the user is authenticated and verified active. */
  async startSession(
    user: { id: string; name: string; email: string },
    tenantSlug: string | undefined,
    client: ClientInfo,
  ) {
    const tenants = await authRepository.findActiveTenantsForUser(user.id);
    let tenant: TenantSummary | null = null;
    const slug = appConfig.tenancy.single ? appConfig.tenancy.defaultSlug : tenantSlug;
    // Single mode: platform users (super admin) without a membership still get a platform session.
    if (slug && (!appConfig.tenancy.single || tenants.length > 0)) {
      tenant = tenants.find((t) => t.slug === slug) ?? null;
      if (!tenant) throw new ForbiddenError('You are not an active member of this tenant');
    } else if (tenants.length === 1) {
      tenant = tenants[0]!;
    }

    await authRepository.recordSuccessfulLogin(user.id);
    return sessionResponse(user, tenant, client, tenants);
  },

  async switchTenant(userId: string, tenantSlug: string, client: ClientInfo) {
    const user = await authRepository.findCredentialsById(userId);
    if (!user?.is_active) throw new UnauthorizedError();
    const tenants = await authRepository.findActiveTenantsForUser(userId);
    const tenant = tenants.find((t) => t.slug === tenantSlug);
    if (!tenant) throw new ForbiddenError('You are not an active member of this tenant');
    return sessionResponse(user, tenant, client, tenants);
  },

  /**
   * Rotation with reuse detection: each refresh token is single-use. Presenting an already
   * rotated token means it leaked, so the whole session family is revoked.
   */
  async refresh(refreshToken: string, client: ClientInfo) {
    const tokenHash = hashRefreshToken(refreshToken);
    const result = await withTransaction(async (trx) => {
      const row = await authRepository.findRefreshTokenForUpdate(tokenHash, trx);
      if (!row) return { error: 'invalid' as const };
      if (row.revoked_at) {
        if (row.replaced_by_id) await authRepository.revokeFamily(row.family_id, trx);
        return { error: row.replaced_by_id ? ('reuse' as const) : ('invalid' as const), row };
      }
      if (row.expires_at <= new Date()) return { error: 'invalid' as const };

      const ctx = await authRepository.loadAuthContext(row.user_id, row.tenant_id);
      if (!ctx) {
        await authRepository.revokeFamily(row.family_id, trx);
        return { error: 'invalid' as const };
      }

      const tokens = await issueTokens(row.user_id, row.tenant_id, client, {
        familyId: row.family_id,
        executor: trx,
      });
      await authRepository.markRotated(row.id, tokens.refreshTokenId, trx);
      return { tokens };
    });

    if ('error' in result) {
      throw new UnauthorizedError(
        result.error === 'reuse'
          ? 'Refresh token reuse detected; session revoked'
          : 'Invalid refresh token',
      );
    }
    const { refreshTokenId: _id, ...tokens } = result.tokens;
    return tokens;
  },

  /** Revokes the session (token family) the refresh token belongs to. Idempotent. */
  async logout(refreshToken: string) {
    const row = await authRepository.findRefreshToken(hashRefreshToken(refreshToken));
    if (row) await authRepository.revokeFamily(row.family_id);
  },

  async logoutAll(userId: string) {
    await authRepository.revokeAllForUser(userId);
  },

  async me(userId: string, tenantId: string | null, permissions: Iterable<string>) {
    const [user, roles, tenants, hubManaged] = await Promise.all([
      db('users')
        .select('id', 'name', 'email', 'last_login_at', 'created_at')
        .where({ id: userId })
        .first(),
      authRepository.findRolesForContext(userId, tenantId),
      authRepository.findActiveTenantsForUser(userId),
      tenantId ? isHubManaged(tenantId) : false,
    ]);
    return {
      id: user.id as string,
      name: user.name as string,
      email: user.email as string,
      lastLoginAt: user.last_login_at as Date | null,
      createdAt: user.created_at as Date,
      tenant: tenants.find((t) => t.id === tenantId) ?? null,
      tenants,
      roles,
      permissions: [...permissions].sort(),
      /** Users, roles and permissions are edited in InvoHub for this tenant. */
      hubManaged,
    };
  },

  /** Re-authentication gate for sensitive account changes. */
  async verifyCurrentPassword(userId: string, currentPassword: string) {
    const user = await authRepository.findCredentialsById(userId);
    if (!user || !(await verifyPassword(user.password_hash, currentPassword))) {
      throw new UnauthorizedError('Current password is incorrect');
    }
    return user;
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    await authService.verifyCurrentPassword(userId, currentPassword);
    const hash = await hashPassword(newPassword);
    await withTransaction(async (trx) => {
      await authRepository.updatePassword(userId, hash, trx);
      await authRepository.revokeAllForUser(userId, trx);
    });
  },

  /**
   * Always resolves the same way so callers cannot probe which emails exist.
   * Returns the raw token for internal use (tests, alternative delivery); never send it to the client.
   */
  async requestPasswordReset(email: string): Promise<string | null> {
    const user = await authRepository.findCredentialsByEmail(email);
    if (!user?.is_active) return null;
    const token = generateToken();
    await authRepository.insertPasswordResetToken(
      user.id,
      hashToken(token, refreshSecret),
      new Date(Date.now() + passwordResetTtlMs),
    );
    await sendPasswordResetEmail(user.email, token);
    return token;
  },

  async resetPassword(token: string, newPassword: string) {
    const hash = await hashPassword(newPassword);
    const ok = await withTransaction(async (trx) => {
      const row = await authRepository.findValidPasswordResetForUpdate(
        hashToken(token, refreshSecret),
        trx,
      );
      if (!row) return false;
      await authRepository.updatePassword(row.user_id, hash, trx);
      await authRepository.markPasswordResetUsed(row.id, trx);
      await authRepository.revokeAllForUser(row.user_id, trx);
      return true;
    });
    if (!ok) throw new UnauthorizedError('Invalid or expired reset token');
  },
};
