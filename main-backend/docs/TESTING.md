# Testing

Vitest with two projects:

| Project       | Path                | Needs DB | What                                                                                                           |
| ------------- | ------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `unit`        | `tests/unit`        | no       | utils, password policy, token signing/verification, guards, service logic with mocked repositories             |
| `integration` | `tests/integration` | yes      | full HTTP via `app.inject`, repositories, transactions, auth flows, RBAC, tenant isolation, validation, errors |

```bash
npm test                  # both
npm run test:unit
npm run test:integration
npm run test:coverage     # coverage/ (v8)
```

## Test database

Integration tests use **`app_test`** (from `.env.test`). They never touch `app_db`.

- Global setup refuses to run unless `DB_NAME` ends with `_test`.
- Once per run it executes `db.ts rollback --all`, `migrate` and `seed` through the real CLI. This proves every migration's `down` works.
- Before each test, `resetDatabase()` deletes tenants and users (FK cascades remove the rest). It keeps the permission catalog and platform roles.
- Test files run serially (`fileParallelism: false`) because they share one DB.

Create the database once: `createdb app_test`. With `docker-compose.dev.yml` it is created automatically; set `DB_PORT=5433` in `.env.test`.

## Writing an integration test

```ts
import { describe, expect, it } from 'vitest';
import { API, bearer, createMember, register, setupTestApp } from '../helpers/test-app';

const app = setupTestApp(); // builds the app, resets the DB before each test, closes after

describe('projects', () => {
  it("hides other tenants' projects", async () => {
    const a = await register(app(), 'a@a.com', 'A');
    const b = await register(app(), 'b@b.com', 'B');
    // create in B, then expect 404 from A
  });
});
```

Helpers: `register`, `login`, `createMember(app, admin, email, roleSlug)`, `createSuperAdmin`, `bearer(session)`, `toSession`.

## Guidelines

- Test behaviour through HTTP for anything with a guard. Test pure logic in unit tests.
- Every new tenant-owned resource needs a cross-tenant 404 test.
- Every new permission-guarded route needs at least one 403 test.
- Don't sleep in tests except to cross a 1-second JWT `iat` boundary (see change-password).
