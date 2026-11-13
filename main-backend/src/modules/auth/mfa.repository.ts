import { db, type DbExecutor } from '../../database/knex';

export interface MfaUserRow {
  id: string;
  email: string;
  mfa_totp_secret: string | null;
  mfa_totp_enabled_at: Date | null;
  mfa_totp_last_step: string | null;
  mfa_email_enabled_at: Date | null;
  mfa_passkey_enabled_at: Date | null;
}

export interface MfaChallengeRow {
  id: string;
  token_hash: string;
  user_id: string;
  tenant_slug: string | null;
  attempts: number;
  email_code_hash: string | null;
  email_sent_at: Date | null;
  passkey_challenge: string | null;
  expires_at: Date;
}

export type MfaColumn = 'mfa_totp_enabled_at' | 'mfa_email_enabled_at' | 'mfa_passkey_enabled_at';

export const mfaRepository = {
  findUser(userId: string, executor: DbExecutor = db) {
    return executor<MfaUserRow>('users')
      .select(
        'id',
        'email',
        'mfa_totp_secret',
        'mfa_totp_enabled_at',
        'mfa_totp_last_step',
        'mfa_email_enabled_at',
        'mfa_passkey_enabled_at',
      )
      .where({ id: userId })
      .whereNull('deleted_at')
      .first();
  },

  async isPasskeyFactorEnabled(userId: string) {
    const r = await db('users')
      .where({ id: userId })
      .whereNotNull('mfa_passkey_enabled_at')
      .first('id');
    return !!r;
  },

  async update(userId: string, patch: Record<string, unknown>, executor: DbExecutor = db) {
    await executor('users').where({ id: userId }).update(patch);
  },

  /** Conditional update: only one concurrent request can consume a given TOTP step. */
  async advanceTotpStep(userId: string, step: number, executor: DbExecutor = db) {
    const n = await executor('users')
      .where({ id: userId })
      .where((q) => q.whereNull('mfa_totp_last_step').orWhere('mfa_totp_last_step', '<', step))
      .update({ mfa_totp_last_step: step });
    return n > 0;
  },

  async replaceRecoveryCodes(userId: string, hashes: string[], executor: DbExecutor) {
    await executor('mfa_recovery_codes').where({ user_id: userId }).delete();
    if (hashes.length)
      await executor('mfa_recovery_codes').insert(
        hashes.map((code_hash) => ({ user_id: userId, code_hash })),
      );
  },

  async countRecoveryCodes(userId: string) {
    const r = await db('mfa_recovery_codes')
      .where({ user_id: userId })
      .whereNull('used_at')
      .count<{ n: string }[]>('* as n');
    return Number(r[0]!.n);
  },

  async useRecoveryCode(userId: string, hash: string, executor: DbExecutor) {
    const n = await executor('mfa_recovery_codes')
      .where({ user_id: userId, code_hash: hash })
      .whereNull('used_at')
      .update({ used_at: executor.fn.now() });
    return n > 0;
  },

  async insertChallenge(row: {
    user_id: string;
    token_hash: string;
    tenant_slug: string | null;
    expires_at: Date;
  }) {
    await db('mfa_challenges').where('expires_at', '<', db.fn.now()).delete();
    await db('mfa_challenges').insert(row);
  },

  findChallengeForUpdate(tokenHash: string, executor: DbExecutor) {
    return executor<MfaChallengeRow>('mfa_challenges')
      .where({ token_hash: tokenHash })
      .forUpdate()
      .first();
  },

  async updateChallenge(id: string, patch: Partial<MfaChallengeRow>, executor: DbExecutor = db) {
    await executor('mfa_challenges').where({ id }).update(patch);
  },

  async deleteChallenge(id: string, executor: DbExecutor = db) {
    await executor('mfa_challenges').where({ id }).delete();
  },
};
