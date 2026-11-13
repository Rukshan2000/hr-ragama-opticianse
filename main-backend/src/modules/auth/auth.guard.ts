import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Permission } from '../../shared/constants/permissions';
import { ForbiddenError, UnauthorizedError } from '../../shared/errors/app-error';
import { authRepository } from './auth.repository';
import { verifyAccessToken } from './token.service';

/**
 * Verifies the bearer token, then re-validates against the DB so deactivation, membership
 * removal, role changes and password changes take effect immediately (not at token expiry).
 */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new UnauthorizedError();
  const payload = verifyAccessToken(header.slice(7));

  const ctx = await authRepository.loadAuthContext(payload.sub, payload.tid);
  if (!ctx) throw new UnauthorizedError('Session is no longer valid');

  // Tokens issued before the last password change are revoked.
  const changedAt = ctx.user.password_changed_at;
  if (changedAt && payload.iat < Math.floor(changedAt.getTime() / 1000)) {
    throw new UnauthorizedError('Session is no longer valid');
  }

  request.auth = {
    userId: ctx.user.id,
    email: ctx.user.email,
    tenantId: payload.tid,
    permissions: new Set(ctx.permissions),
  };
}

export function hasPermissions(granted: ReadonlySet<Permission>, required: readonly Permission[]) {
  return required.every((p) => granted.has(p));
}

/** Route guard: authenticated AND holding every listed permission in the current context. */
export function requirePermissions(...required: Permission[]): preHandlerAsyncHookHandler[] {
  return [
    authenticate,
    async (request) => {
      if (!request.auth || !hasPermissions(request.auth.permissions, required)) {
        throw new ForbiddenError();
      }
    },
  ];
}
