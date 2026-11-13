import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Knex } from 'knex';
import { env } from './env';

// Compiled output runs .js migrations, tsx runs .ts ones.
const ext = path.extname(__filename);
export const migrationsDirectory = path.resolve(__dirname, '../database/migrations');

/**
 * Records migrations without their extension, so a database migrated from source (.ts)
 * and one migrated by the compiled build (.js) share the same history.
 */
const migrationSource: Knex.MigrationSource<string> = {
  async getMigrations() {
    const files = await readdir(migrationsDirectory);
    return files.filter((f) => f.endsWith(ext) && !f.endsWith('.d.ts')).sort();
  },
  getMigrationName: (file) => path.basename(file, ext),
  getMigration: async (file) => import(path.join(migrationsDirectory, file)),
};

export const databaseConfig: Knex.Config = {
  client: 'pg',
  connection: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    ssl: env.DB_SSL ? { rejectUnauthorized: true } : false,
    application_name: env.APP_NAME,
  },
  pool: { min: env.DB_POOL_MIN, max: env.DB_POOL_MAX },
  acquireConnectionTimeout: 10_000,
  migrations: {
    migrationSource,
    tableName: 'knex_migrations',
  },
  seeds: {
    directory: path.resolve(__dirname, '../database/seeds'),
    loadExtensions: [ext],
  },
};
