import { createPublicKey, type KeyObject } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db } from '../../database/knex';
import { env } from '../../config/env';
import { ForbiddenError, UnauthorizedError } from '../../shared/errors/app-error';
import { authRepository } from './auth.repository';
import { authService } from './auth.service';
import type { ClientInfo } from './auth.types';

let key: KeyObject | undefined;
const publicKey = () => (key ??= createPublicKey(env.HUB_PUBLIC_KEY!));

const NO_ACCESS = "You don't have access to this app. Ask your administrator.";

/**
 * Sign-in from InvoHub. The hub proves who the user is (one-time RS256 token, 60 s, this app's
 * `aud`); this app still decides what they can do: the email must be an active user who is an
 * active member of the tenant the hub names in `ext_tenant`. Accounts are never auto-created.
 */
export async function hubLogin(token: string, client: ClientInfo) {
  const c = await redeem(token, 'launch');
  const { email, ext_tenant: tenantId } = c;
  const user = await authRepository.findCredentialsByEmail(email.toLowerCase());
  if (!user?.is_active || typeof tenantId !== 'string') throw new ForbiddenError(NO_ACCESS);
  const tenant = (await authRepository.findActiveTenantsForUser(user.id)).find(
    (t) => t.id === tenantId,
  );
  if (!tenant) throw new ForbiddenError(NO_ACCESS);
  return authService.startSession(user, tenant.slug, client);
}

/** Single logout from InvoHub: revokes every refresh token of this email's user. */
export async function hubLogout(token: string) {
  const { email } = await redeem(token, 'logout');
  const user = await authRepository.findCredentialsByEmail(email.toLowerCase());
  if (user) await authService.logoutAll(user.id); // unknown user: nothing to end
}

/** Verifies a hub token of the given type and burns its jti. */
async function redeem(token: string, typ: 'launch' | 'logout') {
  let c: jwt.JwtPayload;
  try {
    c = jwt.verify(token, publicKey(), {
      algorithms: ['RS256'],
      audience: env.HUB_AUDIENCE,
      issuer: env.HUB_ISSUER,
    }) as jwt.JwtPayload;
  } catch {
    throw new UnauthorizedError('This sign-in link is invalid or has expired');
  }
  const { jti, email, exp } = c;
  // `typ` keeps a sign-in token from being used to sign out, and the other way round.
  if (
    c.typ !== typ ||
    typeof jti !== 'string' ||
    typeof email !== 'string' ||
    typeof exp !== 'number'
  )
    throw new UnauthorizedError('This sign-in link is invalid or has expired');

  // Single use: the primary key rejects a second redemption, even across instances.
  await db('hub_used_tokens').where('expires_at', '<', db.fn.now()).delete();
  const fresh = await db('hub_used_tokens')
    .insert({ jti, expires_at: new Date(exp * 1000) })
    .onConflict('jti')
    .ignore()
    .returning('jti');
  if (fresh.length === 0) throw new UnauthorizedError('This sign-in link was already used');
  return { ...c, email } as jwt.JwtPayload & { email: string };
}
