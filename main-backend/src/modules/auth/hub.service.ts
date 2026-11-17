import { createPublicKey, randomBytes, type KeyObject } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db, withTransaction } from '../../database/knex';
import { env } from '../../config/env';
import { ForbiddenError, UnauthorizedError } from '../../shared/errors/app-error';
import { hashPassword } from '../../shared/utils/password';
import { createTenantWithDefaults } from '../tenants/tenants.service';
import { usersRepository } from '../users/users.repository';
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

/**
 * InvoHub organization opened this app for the first time: create its workspace with the
 * launching user as owner, linked to the hub organization. Idempotent per organization.
 */
export async function hubProvision(token: string) {
  const c = await redeem(token, 'provision');
  if (typeof c.org !== 'string' || typeof c.org_name !== 'string')
    throw new UnauthorizedError('This sign-in link is invalid or has expired');
  const email = c.email.toLowerCase();
  return withTransaction(async (trx) => {
    await trx.raw('select pg_advisory_xact_lock(hashtext(?))', [`hub-org:${c.org}`]);
    const linked = await trx('hub_links')
      .where({ entity: 'tenant', hub_id: c.org })
      .first('local_id');
    if (linked) return { tenantId: linked.local_id as string };
    const userId =
      (await trx('users').where({ email }).whereNull('deleted_at').first('id'))?.id ??
      (await usersRepository.insertUser(
        {
          name: typeof c.name === 'string' ? c.name : email,
          email,
          // Signs in through InvoHub; the local password is random and unknown.
          password_hash: await hashPassword(randomBytes(32).toString('base64url')),
        },
        trx,
      ));
    const tenant = await createTenantWithDefaults(trx, { name: c.org_name, ownerUserId: userId });
    await trx('hub_links').insert({
      entity: 'tenant',
      hub_id: c.org,
      local_id: tenant.id,
      tenant_id: tenant.id,
    });
    return { tenantId: tenant.id };
  });
}

/** Verifies a hub token of the given type and burns its jti. */
export async function redeem(token: string, typ: 'launch' | 'logout' | 'sync' | 'provision') {
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
    (typ !== 'sync' && typeof email !== 'string') ||
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
  return c as jwt.JwtPayload & { email: string };
}
