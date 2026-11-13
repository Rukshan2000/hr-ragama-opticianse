import { execFileSync } from 'node:child_process';

/**
 * Rebuilds the test schema once per run through the real CLI (also proves full rollback works).
 * Runs out-of-process because knex loads migration files with Node's own loader.
 */
export async function setup(): Promise<void> {
  process.env.NODE_ENV = 'test';
  const { env } = await import('../../src/config/env');
  if (!env.DB_NAME.endsWith('_test')) {
    throw new Error(`Refusing to run integration tests against non-test database "${env.DB_NAME}"`);
  }
  const run = (...args: string[]) => {
    try {
      execFileSync('npx', ['tsx', 'scripts/db.ts', ...args], {
        env: { ...process.env, NODE_ENV: 'test' },
        stdio: 'pipe',
      });
    } catch (err) {
      const stderr = (err as { stderr?: Buffer }).stderr?.toString().trim();
      throw new Error(`Test DB setup failed (db.ts ${args.join(' ')}): ${stderr}`, { cause: err });
    }
  };
  run('rollback', '--all');
  run('migrate');
  run('seed');
}
