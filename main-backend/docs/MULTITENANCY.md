# Multi-tenancy

Shared database, shared schema, tenant isolation by `tenant_id`.

## Concepts

| Concept        | Where                                                     |
| -------------- | --------------------------------------------------------- |
| Tenant         | `tenants` (soft-deletable, `is_active`)                   |
| Identity       | `users`, global (one login across tenants)                |
| Membership     | `tenant_memberships (tenant_id, user_id, is_active)`      |
| Tenant roles   | `roles.tenant_id = <tenant>`                              |
| Platform users | users holding a platform role (`roles.tenant_id IS NULL`) |

## Tenant context

1. At login (or `/auth/switch-tenant`) the server checks for an active membership in an active tenant. Only then does it put `tid` in the signed access token.
2. On every request `authenticate` re-checks the membership and tenant status, and builds `request.auth.tenantId`.
3. Services get the tenant with `requireTenantId(request.auth)`, which returns 403 in platform context.

**The client never chooses the tenant per request.** Query params, headers and body fields like `tenantId` are ignored (there is a test for this).

## Writing tenant-safe code

- Tenant-owned tables have `tenant_id NOT NULL` with an FK.
- Repository methods take `tenantId` as their first argument and build queries from `tenantScope(executor, table, tenantId)`:

```ts
tenantScope(db, 'projects as p', tenantId).where('p.id', id).first();
```

- Load-by-id must include the tenant filter, so a foreign id returns **404**, not 403. That way callers can't discover which ids exist in other tenants.
- Validate cross-references. Example: `filterTenantRoleIds` rejects role ids from another tenant.
- Add an isolation test for each new module (see `tests/integration/tenant-isolation.test.ts`).

## Platform vs tenant users

- Platform admins manage tenants via `/api/v1/tenants` from a platform-context session. They do not see tenant data.
- To act inside a tenant, a platform admin needs a real membership there, which leaves an audit trail.

## PostgreSQL Row-Level Security (optional, not enabled)

RLS can serve as a second line of defence, but it is only correct if every query runs with the tenant set for **its own connection**:

```sql
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON projects
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

With a connection pool, the tenant has to be set per transaction:

```ts
await db.transaction(async (trx) => {
  await trx.raw(`select set_config('app.tenant_id', ?, true)`, [tenantId]); // true = transaction-local
  // all tenant queries for this request use trx
});
```

Requirements before enabling it: route all tenant queries through a request-scoped transaction, use a non-owner DB role for the app (owners bypass RLS unless `FORCE ROW LEVEL SECURITY`), and keep a separate role for migrations. Until then, isolation is enforced by `tenantScope` plus the tests.

## Single-tenant mode

Set `TENANCY_MODE=single` to run as a normal single-company app. The schema does not change; everything lives in one built-in tenant (`DEFAULT_TENANT_SLUG`, created on first registration or by the seed).

- `register` needs no `organizationName`. The first user becomes admin and later users get the `user` role.
- `login` always uses the default tenant. `tenantSlug` is ignored and `/auth/switch-tenant` is not registered.
- Platform users (super admin) keep their platform session.

Switching from single to multi later keeps the existing data: the default tenant becomes one tenant among many. Going from multi to single only works cleanly while there is one tenant.
