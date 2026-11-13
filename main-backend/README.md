# Backend Boilerplate

Production-ready API foundation for multi-tenant SaaS products (ERP, LMS, CRM, accounting, …).

**Stack:** Node.js 22 · TypeScript (strict) · Fastify 5 · PostgreSQL 16 · Knex · Zod 4 · JWT · Argon2id · Pino · OpenAPI · Vitest · Docker

## What you get

- Auth: register, login, logout / logout-all, access + refresh tokens, **refresh-token rotation with reuse detection**, change / forgot / reset password, account lockout
- Authorization: RBAC with granular permissions, platform roles vs. tenant roles
- Multi-tenancy: shared schema with `tenant_id`, tenant context from the token (never from the client), membership checks on every request
- API standards: `/api/v1`, uniform response envelope, validation, pagination / sort / filter / search, request IDs
- Security: Helmet, CORS, rate limiting, body limits, env validation, log redaction, no internal errors leaked
- Ops: Pino logs, liveness + readiness probes, graceful shutdown, multi-stage non-root Docker image
- Versioned Knex migrations (with rollback and status), idempotent seeds, 60+ unit and integration tests

## Quick start

```bash
cp .env.example .env              # then fill JWT_*_SECRET (command in the file)
npm install
createdb app_db && createdb app_test   # or: docker compose -f docker-compose.dev.yml up -d postgres (port 5433)
npm run db:migrate
npm run db:seed                   # dev data: superadmin@example.com / admin@demo.example.com, password ChangeMe123!
npm run dev                       # http://localhost:5000/docs
```

> macOS: port 5000 is used by AirPlay Receiver. Set `PORT=5050` in `.env` or turn AirPlay Receiver off.

Try it:

```bash
curl -s localhost:5000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@demo.example.com","password":"ChangeMe123!"}'
```

## Scripts

| Command                                                    | Purpose                                             |
| ---------------------------------------------------------- | --------------------------------------------------- |
| `npm run dev`                                              | Start with hot reload (tsx watch)                   |
| `npm run build` / `npm start`                              | Compile to `dist/` / run compiled server            |
| `npm run lint` / `format` / `typecheck`                    | ESLint / Prettier / `tsc --noEmit`                  |
| `npm test`                                                 | All tests (unit + integration, needs `app_test` DB) |
| `npm run test:unit` / `test:integration` / `test:coverage` | Subsets / coverage report                           |
| `npm run db:migrate`                                       | Apply pending migrations                            |
| `npm run db:rollback`                                      | Roll back last batch (`-- --all` for everything)    |
| `npm run db:status`                                        | Applied / pending migrations                        |
| `npm run db:seed`                                          | Run seeds (demo data skipped in production)         |
| `npm run db:make -- <name>`                                | New migration from the project stub                 |
| `npm run db:migrate:prod`                                  | Run migrations from the compiled build              |
| `npm run audit`                                            | Audit production dependencies                       |

## Project layout

```text
src/
  app.ts, server.ts         app factory / process entry (signals, shutdown)
  config/                   env (Zod-validated), database, logger, app config
  database/                 knex instance + transaction helper, migrations, seeds, migration helpers
  modules/<feature>/        routes → controller → service → repository, plus schema & types
    auth users roles permissions tenants health
  shared/                   errors, plugins (security, swagger, error handler), utils, constants, types
tests/unit, tests/integration, tests/helpers
scripts/db.ts               migration/seed CLI
docs/                       detailed guides (below)
```

## Documentation

| Guide                                    | Covers                                                     |
| ---------------------------------------- | ---------------------------------------------------------- |
| [Architecture](docs/ARCHITECTURE.md)     | Layers, request lifecycle, **adding a module or endpoint** |
| [Database](docs/DATABASE.md)             | Schema, PostgreSQL setup, transactions, repositories       |
| [Migrations](docs/MIGRATIONS.md)         | Conventions, **adding a table**, rollback, safe deploys    |
| [Authentication](docs/AUTHENTICATION.md) | Token flows, rotation, password reset, lockout             |
| [Authorization](docs/AUTHORIZATION.md)   | RBAC, **adding roles & permissions**                       |
| [Multi-tenancy](docs/MULTITENANCY.md)    | Tenant context, isolation rules, RLS notes                 |
| [API standards](docs/API_STANDARDS.md)   | Envelope, errors, pagination, versioning                   |
| [Security](docs/SECURITY.md)             | Controls in place and production checklist                 |
| [Testing](docs/TESTING.md)               | Test DB, writing tests                                     |
| [Deployment](docs/DEPLOYMENT.md)         | Docker, Linux VPS + Nginx                                  |
