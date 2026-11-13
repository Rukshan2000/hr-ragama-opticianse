import { db, type DbExecutor } from '../../database/knex';

export type ChallengePurpose = 'registration' | 'authentication';

export interface PasskeyRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: Buffer;
  counter: string; // BIGINT arrives as string from pg
  transports: string[];
  device_type: string;
  backed_up: boolean;
  device_name: string | null;
  created_at: Date;
  updated_at: Date;
  last_used_at: Date | null;
}

export const passkeyRepository = {
  async insertChallenge(row: {
    purpose: ChallengePurpose;
    challenge: string;
    user_id: string | null;
    expires_at: Date;
  }): Promise<string> {
    // Opportunistic cleanup keeps the table tiny without a scheduler.
    await db('passkey_challenges').where('expires_at', '<', db.fn.now()).delete();
    const [r] = await db('passkey_challenges').insert(row).returning<{ id: string }[]>('id');
    return r!.id;
  },

  /** Atomically deletes and returns the challenge: a second use (replay) finds nothing. */
  async consumeChallenge(id: string, purpose: ChallengePurpose) {
    const [row] = await db('passkey_challenges')
      .where({ id, purpose })
      .delete()
      .returning<{ challenge: string; user_id: string | null; expires_at: Date }[]>([
        'challenge',
        'user_id',
        'expires_at',
      ]);
    return row;
  },

  listForUser(userId: string, executor: DbExecutor = db) {
    return executor<PasskeyRow>('user_passkeys').where({ user_id: userId }).orderBy('created_at');
  },

  findByCredentialId(credentialId: string) {
    return db<PasskeyRow>('user_passkeys').where({ credential_id: credentialId }).first();
  },

  async insert(row: {
    user_id: string;
    credential_id: string;
    public_key: Buffer;
    counter: number;
    transports: string[];
    device_type: string;
    backed_up: boolean;
    device_name: string | null;
  }) {
    const [r] = await db('user_passkeys')
      .insert({ ...row, transports: JSON.stringify(row.transports) })
      .returning<PasskeyRow[]>('*');
    return r!;
  },

  async recordUse(id: string, counter: number, backedUp: boolean) {
    await db('user_passkeys')
      .where({ id })
      .update({ counter, backed_up: backedUp, last_used_at: db.fn.now() });
  },

  /** Scoped by owner so one user can never touch another's credential. */
  async rename(id: string, userId: string, deviceName: string) {
    const [r] = await db('user_passkeys')
      .where({ id, user_id: userId })
      .update({ device_name: deviceName })
      .returning<PasskeyRow[]>('*');
    return r;
  },

  async remove(id: string, userId: string): Promise<boolean> {
    return (await db('user_passkeys').where({ id, user_id: userId }).delete()) > 0;
  },
};
