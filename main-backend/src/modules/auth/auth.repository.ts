import { db, type DbExecutor } from '../../database/knex';
import type { Permission } from '../../shared/constants/permissions';
import type { RefreshTokenRow, TenantSummary, UserCredentialsRow } from './auth.types';

export const authRepository = {
  findCredentialsByEmail(email: string, executor: DbExecutor = db) {
    return executor<UserCredentialsRow>('users')
      .select(
        'id',
        'name',
        'email',
        'password_hash',
        'is_active',
        'failed_login_attempts',
        'locked_until',
      )
      .where({ email })
      .whereNull('deleted_at')
      .first();
  },

  findCredentialsById(id: string, executor: DbExecutor = db) {
    return executor<UserCredentialsRow>('users')
      .select(
        'id',
        'name',
        'email',
        'password_hash',
        'is_active',
        'failed_login_attempts',
        'locked_until',
      )
      .where({ id })
      .whereNull('deleted_at')
      .first();
  },

  /** One atomic statement so concurrent failures cannot under-count. */
  async recordFailedLogin(userId: string, maxAttempts: number, lockoutMs: number): Promise<void> {
    await db('users')
      .where({ id: userId })
      .update({
        failed_login_attempts: db.raw('failed_login_attempts + 1'),
        locked_until: db.raw(
          `CASE WHEN failed_login_attempts + 1 >= ? THEN now() + (? * interval '1 millisecond') ELSE locked_until END`,
          [maxAttempts, lockoutMs],
        ),
      });
  },

  async resetFailedLogins(userId: string): Promise<void> {
    await db('users')
      .where({ id: userId })
      .update({ failed_login_attempts: 0, locked_until: null });
  },

  async recordSuccessfulLogin(userId: string): Promise<void> {
    await db('users')
      .where({ id: userId })
      .update({ failed_login_attempts: 0, locked_until: null, last_login_at: db.fn.now() });
  },

  async updatePassword(userId: string, passwordHash: string, executor: DbExecutor = db) {
    await executor('users').where({ id: userId }).update({
      password_hash: passwordHash,
      password_changed_at: executor.fn.now(),
      failed_login_attempts: 0,
      locked_until: null,
    });
  },

  findActiveTenantsForUser(userId: string): Promise<TenantSummary[]> {
    return db('tenant_memberships as m')
      .join('tenants as t', 't.id', 'm.tenant_id')
      .select('t.id', 't.name', 't.slug')
      .where({ 'm.user_id': userId, 'm.is_active': true, 't.is_active': true })
      .whereNull('t.deleted_at')
      .orderBy('t.name');
  },

  /**
   * Loads everything an authenticated request needs in two parallel queries.
   * Returns null if the user, membership or tenant is no longer active.
   */
  async loadAuthContext(userId: string, tenantId: string | null) {
    const userQuery = db('users as u')
      .select('u.id', 'u.email', 'u.password_changed_at')
      .where({ 'u.id': userId, 'u.is_active': true })
      .whereNull('u.deleted_at')
      .first();
    if (tenantId) {
      userQuery
        .join('tenant_memberships as m', function () {
          this.on('m.user_id', 'u.id').andOn('m.tenant_id', db.raw('?', [tenantId]));
        })
        .join('tenants as t', 't.id', 'm.tenant_id')
        .where({ 'm.is_active': true, 't.is_active': true })
        .whereNull('t.deleted_at');
    }

    const permissionQuery = db('user_roles as ur')
      .join('roles as r', 'r.id', 'ur.role_id')
      .join('role_permissions as rp', 'rp.role_id', 'r.id')
      .join('permissions as p', 'p.id', 'rp.permission_id')
      .distinct('p.key')
      .where('ur.user_id', userId)
      .modify((q) => (tenantId ? q.where('r.tenant_id', tenantId) : q.whereNull('r.tenant_id')));

    const [user, perms] = await Promise.all([
      userQuery as Promise<
        { id: string; email: string; password_changed_at: Date | null } | undefined
      >,
      permissionQuery as Promise<{ key: Permission }[]>,
    ]);
    if (!user) return null;
    return { user, permissions: perms.map((p) => p.key) };
  },

  findRolesForContext(userId: string, tenantId: string | null) {
    return db('user_roles as ur')
      .join('roles as r', 'r.id', 'ur.role_id')
      .select('r.id', 'r.name', 'r.slug')
      .where('ur.user_id', userId)
      .modify((q) => (tenantId ? q.where('r.tenant_id', tenantId) : q.whereNull('r.tenant_id')))
      .orderBy('r.name');
  },

  async insertRefreshToken(
    row: {
      id?: string;
      user_id: string;
      tenant_id: string | null;
      family_id: string;
      token_hash: string;
      expires_at: Date;
      ip?: string;
      user_agent?: string;
    },
    executor: DbExecutor = db,
  ): Promise<string> {
    const [inserted] = await executor('refresh_tokens')
      .insert(row)
      .returning<{ id: string }[]>('id');
    return inserted!.id;
  },

  /** Row-locked so two concurrent refreshes with the same token cannot both succeed. */
  findRefreshTokenForUpdate(tokenHash: string, executor: DbExecutor) {
    return executor<RefreshTokenRow>('refresh_tokens')
      .select(
        'id',
        'user_id',
        'tenant_id',
        'family_id',
        'expires_at',
        'revoked_at',
        'replaced_by_id',
      )
      .where({ token_hash: tokenHash })
      .forUpdate()
      .first();
  },

  findRefreshToken(tokenHash: string) {
    return db<RefreshTokenRow>('refresh_tokens')
      .select('id', 'user_id', 'family_id')
      .where({ token_hash: tokenHash })
      .first();
  },

  async markRotated(id: string, replacedById: string, executor: DbExecutor) {
    await executor('refresh_tokens')
      .where({ id })
      .update({ revoked_at: executor.fn.now(), replaced_by_id: replacedById });
  },

  async revokeFamily(familyId: string, executor: DbExecutor = db) {
    await executor('refresh_tokens')
      .where({ family_id: familyId })
      .whereNull('revoked_at')
      .update({ revoked_at: executor.fn.now() });
  },

  async revokeAllForUser(userId: string, executor: DbExecutor = db) {
    await executor('refresh_tokens')
      .where({ user_id: userId })
      .whereNull('revoked_at')
      .update({ revoked_at: executor.fn.now() });
  },

  async insertPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date) {
    await db.transaction(async (trx) => {
      // Only the newest reset link stays valid.
      await trx('password_reset_tokens')
        .where({ user_id: userId })
        .whereNull('used_at')
        .update({ used_at: trx.fn.now() });
      await trx('password_reset_tokens').insert({
        user_id: userId,
        token_hash: tokenHash,
        expires_at: expiresAt,
      });
    });
  },

  findValidPasswordResetForUpdate(tokenHash: string, executor: DbExecutor) {
    return executor('password_reset_tokens')
      .select<{ id: string; user_id: string }>('id', 'user_id')
      .where({ token_hash: tokenHash })
      .whereNull('used_at')
      .where('expires_at', '>', executor.fn.now())
      .forUpdate()
      .first();
  },

  async markPasswordResetUsed(id: string, executor: DbExecutor) {
    await executor('password_reset_tokens').where({ id }).update({ used_at: executor.fn.now() });
  },
};
