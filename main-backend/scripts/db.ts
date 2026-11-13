import path from 'node:path';
import { env } from '../src/config/env';
import { migrationsDirectory } from '../src/config/database';
import { db } from '../src/database/knex';

const [command, ...args] = process.argv.slice(2);
const isProd = env.NODE_ENV === 'production';
const force = args.includes('--force');

async function run(): Promise<void> {
  switch (command) {
    case 'migrate': {
      // knex holds knex_migrations_lock for the duration, so concurrent deploys cannot race.
      const [batch, files] = await db.migrate.latest();
      console.log(
        files.length
          ? `Batch ${batch}: ran ${files.length}\n  ${files.join('\n  ')}`
          : 'Already up to date',
      );
      break;
    }
    case 'rollback': {
      if (isProd && !force) throw new Error('Refusing to roll back in production without --force');
      const [batch, files] = await db.migrate.rollback(undefined, args.includes('--all'));
      console.log(
        files.length
          ? `Rolled back batch ${batch}:\n  ${files.join('\n  ')}`
          : 'Nothing to roll back',
      );
      break;
    }
    case 'status': {
      const [done, pending] = (await db.migrate.list()) as [{ name: string }[], string[]];
      console.log(`Database: ${env.DB_NAME}@${env.DB_HOST}`);
      console.log(`Applied (${done.length}):`);
      done.forEach((m) => console.log(`  ✔ ${m.name}`));
      console.log(`Pending (${pending.length}):`);
      pending.forEach((m) => console.log(`  • ${m}`));
      break;
    }
    case 'seed': {
      const [files] = await db.seed.run();
      console.log(`Ran ${files.length} seed files`);
      break;
    }
    case 'make': {
      const name = args.find((a) => !a.startsWith('--'));
      if (!name || !/^[a-z0-9_]+$/.test(name))
        throw new Error('Usage: npm run db:make -- <snake_case_name>');
      const file = await db.migrate.make(name, {
        directory: migrationsDirectory,
        extension: 'ts',
        stub: path.resolve(__dirname, 'migration.stub'),
      });
      console.log(`Created ${path.relative(process.cwd(), file)}`);
      break;
    }
    default:
      throw new Error('Usage: db.ts <migrate|rollback [--all]|status|seed|make <name>>');
  }
}

run()
  .catch((err: Error) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
