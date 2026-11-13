# Migrations

## Commands

```bash
npm run db:make -- create_projects   # new file from scripts/migration.stub
npm run db:migrate                   # apply pending (holds knex_migrations_lock)
npm run db:status                    # applied / pending
npm run db:rollback                  # undo the last batch
npm run db:rollback -- --all         # undo everything (dev only)
node dist/scripts/db.js migrate      # production, from the compiled image
```

Rollback refuses to run with `NODE_ENV=production` unless you pass `--force`.

Migration names are recorded **without** the file extension, so a database migrated from source (`.ts`) and one migrated by the build (`.js`) share the same history.

## Rules

1. **Never edit a migration that has been applied anywhere shared** (staging, prod, a teammate's DB). Write a new one.
2. Each migration does one logical change and has a working `down` (where data loss allows).
3. Name files `YYYYMMDDHHMMSS_verb_object.ts`: `create_projects`, `add_due_date_to_tasks`.
4. Use the helpers in `src/database/migration-helpers.ts`:

```ts
import type { Knex } from 'knex';
import { primaryUuid, softDelete, timestamps, updatedAtTrigger } from '../migration-helpers';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('projects', (table) => {
    primaryUuid(knex, table);
    table.uuid('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    table.string('name', 150).notNullable();
    timestamps(knex, table);
    softDelete(table);
    table.index(['tenant_id', 'created_at']);
  });
  await knex.raw(
    'CREATE UNIQUE INDEX projects_tenant_name_unique ON projects (tenant_id, name) WHERE deleted_at IS NULL',
  );
  await updatedAtTrigger(knex, 'projects');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('projects');
}
```

5. Tenant-owned tables **must** have `tenant_id NOT NULL` with an FK, plus an index that starts with `tenant_id`.
6. With soft delete, use partial unique indexes (`WHERE deleted_at IS NULL`) so deleted rows don't block reuse.
7. Don't import application code (services/repositories) in migrations. They must keep working as the code changes. Seeds may import application code.

## Adding a table: checklist

- [ ] `npm run db:make -- create_x`
- [ ] UUID PK, timestamps, `tenant_id` if tenant-owned, FKs with `onDelete`, indexes
- [ ] `updatedAtTrigger`
- [ ] `down` drops what `up` created
- [ ] `npm run db:migrate && npm run db:rollback && npm run db:migrate` locally
- [ ] `npm test` (the test run rolls everything back and re-migrates)

## Safe production changes (expand → migrate → contract)

Destructive changes never ship in the same release as the code that stops using the column.

| Change                 | Safe sequence                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| Rename column          | add new → dual-write/backfill → switch reads → drop old (later release)                         |
| Add NOT NULL column    | add nullable/with default → backfill → `SET NOT NULL`                                           |
| Drop column/table      | stop using it in code → deploy → drop in a later migration                                      |
| Index on a large table | `CREATE INDEX CONCURRENTLY` in a migration with `export const config = { transaction: false };` |

## Deploy procedure

1. Back up the database (`pg_dump -Fc`).
2. Review the pending migrations (`db:status`). Look for locks on large tables and for destructive operations.
3. Run `migrate` as a **one-off job** before the new API starts (`docker compose` does this with the `migrate` service). Knex's lock table prevents two deploys from migrating at once.
4. Start the new version. If it fails, roll back the **code** first. Roll back the schema only if the migration is reversible and you have checked for data loss (`--force`).
