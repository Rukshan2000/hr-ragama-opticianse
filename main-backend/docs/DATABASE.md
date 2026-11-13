# Database

PostgreSQL 15+ is required (the schema uses `NULLS NOT DISTINCT`); 16 is the reference version. Queries go through Knex, and every value is parameterized. The only raw SQL uses `?`/`??` bindings.

## Setup

Local install:

```bash
createdb app_db
createdb app_test          # used only by integration tests
```

Or Docker: `docker compose -f docker-compose.dev.yml up -d postgres` gives you PostgreSQL on **localhost:5433**, with `app_db` and `app_test` already created. Set `DB_PORT=5433`.

Connection settings come from `DB_*` env vars (see `.env.example`). `DB_SSL=true` enables TLS with certificate verification.

## Schema overview

```text
tenants ─┬─< tenant_memberships >── users ──< refresh_tokens
         │                            │   └─< password_reset_tokens
         └─< roles (tenant_id NULL = platform role)
               ├─< role_permissions >── permissions
               └─< user_roles >── users
```

| Table                   | Notes                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `users`                 | Global identity. `email` is `citext`, unique among non-deleted rows. Soft delete via `deleted_at`. Lockout columns. |
| `tenants`               | `slug` unique among non-deleted rows. Soft delete.                                                                  |
| `tenant_memberships`    | User ↔ tenant, with per-tenant `is_active`.                                                                         |
| `roles`                 | `tenant_id` NULL = platform role. `(tenant_id, slug)` unique. `is_system` roles can't be deleted.                   |
| `permissions`           | Catalog synced from code by the seed.                                                                               |
| `refresh_tokens`        | HMAC hash only, `family_id` for reuse detection.                                                                    |
| `password_reset_tokens` | HMAC hash only, single use.                                                                                         |

Conventions: UUID PKs (`gen_random_uuid()`), `timestamptz` timestamps, `updated_at` maintained by a trigger, FKs with explicit `ON DELETE`, and indexes on every FK column used for lookups.

## Connection and transactions

`src/database/knex.ts` exports one pooled `db` instance, `withTransaction(fn)` and the `DbExecutor` type (`Knex | Knex.Transaction`).

Repository methods take an optional `executor` so services can compose them atomically:

```ts
await withTransaction(async (trx) => {
  const id = await usersRepository.insertUser(data, trx);
  await usersRepository.addMembership(tenantId, id, trx);
}); // any throw rolls everything back
```

Use row locks (`.forUpdate()`) when a read decides a write. Refresh-token rotation does this.

## Avoiding N+1

- Aggregate related data in SQL. For example, roles return `array_agg(permission.key)`.
- Or batch it. For example, `usersRepository.rolesForUsers(tenantId, ids)` loads the roles for a whole page in one query.
- `paginate()` runs the count and page queries in parallel. The count uses a subquery, so grouped queries count correctly.

## Seeds

| Seed                                | Environments     | What                                                                                                   |
| ----------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------ |
| `01_permissions_and_platform_roles` | all (idempotent) | Syncs the permission catalog and the Super Admin role                                                  |
| `02_demo_data`                      | non-production   | Super admin and a demo tenant with an admin. Override with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. |

In production, run only reference seeds: `node dist/scripts/db.js seed` (the demo seed exits early when `NODE_ENV=production`).
