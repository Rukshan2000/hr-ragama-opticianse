import knexFactory, { type Knex } from 'knex';
import pg from 'pg';
import { databaseConfig } from '../config/database';

// Calendar dates (DOB, joining date, leave days) stay 'YYYY-MM-DD' strings; parsing them into
// JS Dates would shift them by the server's UTC offset. Instants use timestamptz.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export const db: Knex = knexFactory(databaseConfig);

/** Either the pool or an open transaction; repositories accept both. */
export type DbExecutor = Knex | Knex.Transaction;

export function withTransaction<T>(fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

export async function checkDatabase(): Promise<void> {
  await db.raw('select 1');
}
