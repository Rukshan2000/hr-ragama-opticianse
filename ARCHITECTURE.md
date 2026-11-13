# HR Ragama: System Design & Architecture

This document covers the whole system: the **Next.js frontend** (`main-frontend`) and the **Fastify backend** (`main-backend`). It explains how the parts fit together, which design patterns each side uses, and the rules for extending them.

Deeper backend references live in [main-backend/docs/](main-backend/docs/) (authentication, MFA, passkeys, migrations, testing, deployment, security).

---

## 1. System overview

```text
┌──────────────────────────── Browser ────────────────────────────┐
│  React 19 client components  (TanStack Query, react-hook-form)   │
│  fetch("/api/...")  same-origin, cookies only, no tokens in JS  │
└───────────────────────────────┬──────────────────────────────────┘
                                │ HttpOnly cookies (jar_at, jar_rt)
┌───────────────────────────────▼──────────────────────────────────┐
│  Next.js 16 server  (main-frontend)                              │
│   • proxy.ts               optimistic page guard (redirects)     │
│   • app/api/[...path]      BFF: attaches token, rotates, strips   │
└───────────────────────────────┬──────────────────────────────────┘
                                │ Authorization: Bearer <JWT>
┌───────────────────────────────▼──────────────────────────────────┐
│  Fastify 5 API  /api/v1  (main-backend)                          │
│   security → Zod validation → auth guard → controller →          │
│   service → repository (Knex) → envelope / error handler         │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                      ┌─────────▼─────────┐
                      │  PostgreSQL 16    │
                      │  shared schema,   │
                      │  tenant_id scoping│
                      └───────────────────┘
```

### Technology stack

| Concern        | Frontend                                         | Backend                                       |
| -------------- | ------------------------------------------------ | --------------------------------------------- |
| Runtime        | Next.js 16 (App Router), React 19                | Node 22, Fastify 5                            |
| Language       | TypeScript                                       | TypeScript (strict)                           |
| Validation     | Zod 4 + react-hook-form                          | Zod 4 via `fastify-type-provider-zod`         |
| Data / state   | TanStack Query 5                                 | Knex 3 + `pg`                                 |
| UI             | Tailwind 4, shadcn/Base UI, lucide, sonner       | n/a                                           |
| Auth           | BFF with HttpOnly cookies, `@simplewebauthn/browser` | JWT (HS256) + opaque refresh tokens, Argon2id, WebAuthn, TOTP |
| Docs / tooling | ESLint                                           | Swagger/OpenAPI, Vitest, ESLint, Prettier, Husky |
| Deploy         | `next build` / `next start`                      | Multi-stage Docker, Compose (postgres → migrate → api) |

### Architectural style

- **Modular monolith** on the backend: feature modules inside one deployable.
- **Backend-for-Frontend (BFF)**: the Next.js server is the only client of the API, and it keeps every token out of browser JavaScript.
- **Multi-tenant SaaS**: shared database and shared schema, isolated by `tenant_id`. A single-tenant mode is available.
- **RBAC** with fine-grained `resource:action` permissions, evaluated per tenant context.

---

## 2. Backend architecture (`main-backend`)

### 2.1 Directory layout

```text
src/
├── server.ts              bootstrap, graceful shutdown (SIGTERM → drain → close pool)
├── app.ts                 buildApp(): plugins, error handlers, route registration
├── config/                env.ts (Zod-validated env), app/database/logger config
├── database/
│   ├── knex.ts            db pool, DbExecutor type, withTransaction()
│   ├── migrations/        timestamped, ordered schema migrations
│   └── seeds/             permission catalog + platform roles, demo data
├── shared/                cross-cutting code; never imports from modules/
│   ├── constants/permissions.ts   single source of truth for permissions & default roles
│   ├── errors/app-error.ts        typed HTTP error hierarchy
│   ├── plugins/                   security (helmet/cors/rate-limit), swagger, error-handler
│   ├── types/auth.ts              AuthContext
│   └── utils/                     tenant-scope, pagination, response, crypto, password, totp, mailer…
└── modules/
    ├── auth/        login, refresh, tenants switch, MFA, passkeys, guard
    ├── users/       tenant user management
    ├── roles/       tenant roles + permission assignment
    ├── permissions/ read-only catalog (single route file)
    ├── tenants/     platform-level tenant administration
    └── health/      liveness/readiness
```

**Dependency direction:** `modules → shared → config`. `shared` never imports from `modules`.

### 2.2 Layered architecture (per module)

| Layer      | File              | Responsibility                                             | Must not             |
| ---------- | ----------------- | ---------------------------------------------------------- | -------------------- |
| Route      | `*.routes.ts`     | Path, method, Zod schemas, guards, OpenAPI tags            | contain logic        |
| Controller | `*.controller.ts` | Read the request, call the service, shape the response     | touch the DB         |
| Service    | `*.service.ts`    | Business rules, transactions, data-dependent authorization | know about HTTP      |
| Repository | `*.repository.ts` | Knex queries, tenant scoping                               | hold business rules  |
| Schema     | `*.schema.ts`     | Zod input schemas and inferred TS types                    | n/a                  |

Small modules may skip layers. For example, `permissions` is a single route file until it needs more.

### 2.3 Request lifecycle

```text
request
 → genReqId (honours a valid upstream x-request-id, else UUID)     app.ts
 → helmet / CORS / global + auth rate limits                       shared/plugins/security.ts
 → Zod validation of params / query / body                         fastify-type-provider-zod
 → preHandler: authenticate → requirePermissions(...)              modules/auth/auth.guard.ts
 → controller → service → repository → PostgreSQL
 → sendSuccess() envelope, x-request-id response header            shared/utils/response.ts
 ↳ any thrown error → central error handler                        shared/plugins/error-handler.ts
```

### 2.4 Backend design patterns

| Pattern | Where | Notes |
| --- | --- | --- |
| **Modular monolith / feature modules** | `src/modules/*` | Each module owns routes → schema. Modules call each other's services and repositories, never each other over HTTP. |
| **Layered (N-tier) architecture** | route/controller/service/repository | One job per layer (table above). |
| **Repository pattern** | `*.repository.ts` | The only place that writes SQL. Every method takes an optional `executor: DbExecutor = db`, so the same method works in or out of a transaction. |
| **Unit of Work (transactions)** | `withTransaction(fn)` in `database/knex.ts` | The service opens the transaction and passes `trx` to repositories. |
| **Module-level singletons instead of a DI container** | `export const usersService = { … }` | Plain objects; tests swap them with `vi.mock`. Add an interface only when a real second implementation appears. |
| **Plugin pattern** | Fastify `register()` | Security, Swagger and each route group are encapsulated plugins under `API_PREFIX`. |
| **Guard / middleware chain** | `requirePermissions(...)` returns `[authenticate, check]` preHandlers | Declarative authorization on each route. |
| **Schema-first validation + type inference** | Zod schemas → `z.infer` types → OpenAPI | One definition drives runtime validation, TS types and Swagger docs. |
| **Typed exception hierarchy** | `AppError` → `BadRequest/Validation/Unauthorized/Forbidden/NotFound/Conflict/TooManyRequests` | Services throw errors. A central handler turns them into the error envelope. |
| **Centralized error handler** | `registerErrorHandlers` | Zod errors → 422 with `field` paths (`body.email`); 5xx are logged, and the client only sees "Internal server error". |
| **Response envelope** | `sendSuccess` | `{ success, message, data, meta }` on every endpoint. |
| **Scoped query builder (tenant guard)** | `tenantScope(executor, table, tenantId)` | Every tenant-table query starts here, so the filter cannot be forgotten. |
| **Context object** | `request.auth: AuthContext` | `{ userId, email, tenantId, permissions:Set }`, rebuilt from the DB on every request. |
| **Configuration as validated schema** | `config/env.ts` | The process fails fast on invalid env. |
| **Allow-listed list queries** | `listQuerySchema(sortable, default)` + `paginate()` | Sorting only on allow-listed columns, `limit` 1–100, ILIKE search escaped by `likeTerm`. |
| **Token rotation with reuse detection** | `token.service.ts`, `refresh_tokens.family_id` | `SELECT … FOR UPDATE`. Replaying a rotated token revokes the whole family. |
| **Code-as-source-of-truth seeding** | `shared/constants/permissions.ts` + idempotent seed | The permission catalog is synced from code. |
| **Soft delete** | `deleted_at` on `users`, `tenants` | Unique indexes are partial and only cover non-deleted rows. |

### 2.5 Data model

```text
tenants ─┬─< tenant_memberships >── users ──< refresh_tokens
         │                            │   ├─< password_reset_tokens
         │                            │   ├─< user_passkeys
         │                            │   └─< mfa (TOTP / email / passkey factors, recovery codes)
         └─< roles (tenant_id NULL = platform role)
               ├─< role_permissions >── permissions
               └─< user_roles >── users
```

Conventions:
- UUID primary keys (`gen_random_uuid()`), `timestamptz` timestamps, `updated_at` maintained by a trigger.
- `citext` emails that are unique among non-deleted rows. FKs have explicit `ON DELETE` and are indexed.
- Secrets are never stored in plain text. Refresh and reset tokens are HMAC-SHA256 hashes, and passwords use Argon2id.
- Migrations are timestamped TypeScript files (`npm run db:make -- <name>`), and `migrate` runs as a separate Compose step before the API starts.

### 2.6 Multi-tenancy

- **Identity is global.** Users exist once and join tenants through `tenant_memberships`.
- **The tenant comes from the token, never from the client.** At login or `/auth/switch-tenant`, the server verifies an active membership and puts `tid` into the signed JWT. On every request, `authenticate` checks the membership and tenant status again. `requireTenantId(auth)` returns 403 in platform context. Any `tenantId` in the query, headers or body is ignored.
- **A foreign id returns 404, not 403**, so callers can't find out which ids exist in other tenants.
- **Cross-references are validated.** For example, role ids from another tenant are rejected.
- **Platform vs tenant context.** A session with `tid = null` is the platform context: only platform roles apply, and only `/tenants` is reachable. Super Admins have no implicit power inside tenants.
- **Single-tenant mode** (`TENANCY_MODE=single`) uses the same schema with one built-in tenant. `switch-tenant` is not registered in this mode.
- PostgreSQL RLS is documented as an optional second line of defence but is **not enabled**. See [MULTITENANCY.md](main-backend/docs/MULTITENANCY.md).

### 2.7 Authorization (RBAC)

- Permission keys use the form `resource:action` (`users:read`, `roles:manage`, `tenants:manage`…).
- Roles: platform (`tenant_id IS NULL`) or per-tenant. Default tenant roles are **Admin, Manager, User**, created for each new tenant. They are `is_system`, so they can be edited but not deleted.
- Routes declare permissions: `preHandler: requirePermissions(P.USERS_CREATE)`. Every listed permission is required.
- Data-dependent rules live in services. For example, assigning roles needs `roles:manage`, which stops privilege escalation. Users also cannot change their own roles or status, or remove themselves.

### 2.8 Authentication

| | Access token | Refresh token |
|---|---|---|
| Format | JWT HS256 (`iss`, `aud`, `sub`, `tid`, `typ`) | 256-bit random, opaque |
| Lifetime | 15 min (`JWT_ACCESS_EXPIRES_IN`) | 7 days (`JWT_REFRESH_EXPIRES_IN`) |
| Storage | none (stateless) | HMAC hash in `refresh_tokens` |

- Although JWTs are stateless, every request re-checks user, membership and tenant status in the DB, and rejects tokens issued before `password_changed_at`. Revocation is immediate.
- Supported login methods: **password**, **passkeys (WebAuthn)**, and a second factor (**MFA**: TOTP, email code, passkey, recovery codes). A login that needs MFA returns an `mfaToken` instead of a session. `/auth/mfa/verify` then completes it.
- Hardening includes Argon2id (OWASP parameters), dummy hashing for unknown emails (no timing oracle), atomic lockout counters (429), a stricter per-IP auth rate limit, and a uniform `forgot-password` response.

### 2.9 API conventions

- Prefix `/api/v1`. Breaking changes get a new prefix registered beside the old one.
- Resources are plural nouns. Sub-actions are written as `/users/:id/status`. `GET` reads, `POST` creates or runs an action, `PATCH` partially updates, `DELETE` removes.
- Lists: `?page&limit&sort&order&search&<filters>`. The response is `data: T[]`, `meta: { page, limit, total, totalPages }`.
- Status codes: 400 bad request, 401 unauthenticated, 403 forbidden, 404 missing or in another tenant, 409 conflict, 413 too large, 422 validation, 429 rate limit or lockout, 500 opaque.
- Swagger UI is generated from the route schemas when `swaggerEnabled` is on.

### 2.10 Cross-cutting concerns

- **Logging:** pino, with `x-request-id` propagated on every log line and response.
- **Security headers / CORS / rate limit:** `shared/plugins/security.ts`.
- **Mail:** `shared/utils/mailer.ts` is the single integration point. In development it logs the link.
- **Testing:** Vitest `unit` and `integration` projects. Integration tests run against a real `app_test` database through `setupTestApp()` and include tenant-isolation, RBAC, MFA and passkey suites.
- **Quality gates:** ESLint, Prettier, `tsc --noEmit`, and Husky + lint-staged on pre-commit.

---

## 3. Frontend architecture (`main-frontend`)

### 3.1 Directory layout

```text
src/
├── proxy.ts                    Next middleware: optimistic auth redirects
├── app/                        App Router: routing + layouts only (thin pages)
│   ├── layout.tsx              root: fonts, theme vars, <AppProviders>
│   ├── (auth)/                 guest pages: login, register, forgot/reset password
│   ├── (app)/                  authenticated pages inside <AppShell>
│   │   ├── page.tsx            dashboard
│   │   └── users | roles | permissions | tenants | settings
│   ├── select-organization/    tenant picker after multi-tenant login
│   └── api/[...path]/route.ts  BFF proxy to the Fastify API
├── features/                   feature slices: page components, dialogs, hooks
│   ├── auth/  users/  roles/  permissions/  tenants/  settings/  dashboard/
├── components/
│   ├── ui/                     shadcn/Base UI primitives (button, dialog, sheet…)
│   ├── shared/                 app-level building blocks (DataTable, states, forms, guards)
│   └── layout/                 AppShell, AppSidebar, AppHeader, Brand
├── lib/
│   ├── api/                    client.ts (fetch + ApiError), endpoints.ts, types.ts
│   ├── session.ts              cookie names
│   ├── validation.ts / format.ts / utils.ts
├── hooks/                      use-session, use-list-state, use-debounced
├── providers/app-providers.tsx ThemeProvider + QueryClientProvider + Tooltip + Toaster
└── config/                     navigation, tenancy, theme + colors.json
```

### 3.2 Layering

```text
app/<route>/page.tsx        →  renders a feature page (no logic)
features/<x>/<x>-page.tsx   →  composes shared components, wires hooks
features/<x>/use-<x>.ts     →  TanStack Query queries & mutations
lib/api/endpoints.ts        →  typed API functions per resource
lib/api/client.ts           →  fetch wrapper, envelope unwrap, ApiError
app/api/[...path]/route.ts  →  BFF → Fastify
```

### 3.3 Frontend design patterns

| Pattern | Where | Notes |
| --- | --- | --- |
| **Backend-for-Frontend (BFF) / reverse proxy** | `app/api/[...path]/route.ts` | Forwards every `/api/*` call. Attaches `Bearer` from the HttpOnly cookie, removes tokens from auth responses, and sets or clears cookies. `auth/refresh` is blocked for clients. |
| **Transparent token refresh with request coalescing** | `rotate()` + `inflight` map | Concurrent 401s share one refresh, which avoids tripping backend reuse detection. *ponytail note: in-process, so it needs sticky sessions or a shared store if Next is scaled out.* |
| **Feature-sliced structure** | `src/features/*` | UI, dialogs and hooks for a domain live together. `app/` stays a thin routing layer. |
| **API gateway / service module** | `lib/api/endpoints.ts` | `authApi`, `usersApi`, `rolesApi`, `mfaApi`, `passkeysApi`… are typed functions over one `request()`. |
| **Envelope unwrapping + typed error** | `lib/api/client.ts` | `ApiError(message, status, errors)`. A 401 hard-redirects to `/login?next=…`. `applyFieldErrors` maps `body.email` to the form field `email`. |
| **Server-state cache (stale-while-revalidate)** | TanStack Query | Query keys like `["users","list",params]`. Mutations invalidate the `["users"]` prefix. 4xx errors are never retried. `placeholderData` keeps the previous page during pagination. |
| **Custom hooks for state logic** | `useSession`, `useListState`, `useDebounced`, `use-users`, `use-roles` | `useListState` resets the page on search/sort and debounces search. |
| **Session as a query** | `useSession()` → `auth/me` | Exposes `me`, `inTenant`, `can(...perms)`. It is the single source for permission-aware UI. |
| **Guarded routes (two layers)** | `proxy.ts` (cookie presence) + `<RequirePermission permission context>` | Both are UX guards only. **The backend is authoritative.** |
| **Configuration-driven navigation** | `config/navigation.ts` | Nav items declare `permission` and `context` (`tenant`/`platform`). `visibleNavigation(can, inTenant)` filters them. |
| **Composition / compound components** | `PageContainer`, `PageHeader`, `ContentCard`, `DataTable`, `Pagination`, `SearchInput`, `FilterDropdown`, `ActionDropdown`, `ConfirmDialog` | Every list page is assembled from the same parts. |
| **Generic, column-config table** | `DataTable<T>` with `Column<T>[]` and `SortState` | Supports server-side sorting and pagination. |
| **Explicit UI states** | `LoadingState`, `EmptyState`, `ErrorState` (with retry) | Used consistently on every data view. |
| **Provider pattern** | `AppProviders` | Theme, query client, tooltips and toasts, set up once at the root. |
| **Design tokens** | `config/colors.json` → `theme.ts` → CSS variables | Light and dark palettes map onto shadcn tokens. Components only read `var(--…)`. |
| **Schema-validated forms** | react-hook-form + Zod (`lib/validation.ts`) + `FormField` | Server 422 errors are applied back onto the same fields. |
| **Variant styling** | `class-variance-authority` (`buttonVariants`) | Typed visual variants. |
| **Feature flag by env** | `config/tenancy.ts` (`NEXT_PUBLIC_TENANCY_MODE`) | Hides organization UI in single-tenant mode. |

### 3.4 Authentication flow (end to end)

```text
LoginForm ──POST /api/auth/login──▶ BFF ──▶ API
                                     │
       ┌─────────────────────────────┼─────────────────────────────┐
       │ mfaRequired → <MfaStep>     │ success                     │
       │ POST /api/auth/mfa/verify   │ BFF moves accessToken /     │
       │ (TOTP / email / passkey /   │ refreshToken into HttpOnly  │
       │  recovery code)             │ cookies, strips them from   │
       └─────────────────────────────┤ the JSON body               │
                                     ▼                             │
               several tenants & none chosen → /select-organization│
               → POST /api/auth/switch-tenant                      │
                                     ▼
                               AppShell → useSession(auth/me)
```

- **Cookies:** `jar_at` (access, max-age = expiresIn − 30 s) and `jar_rt` (refresh, 7 days). Both are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- **Expiry:** a missing access cookie or an upstream 401 makes the BFF rotate once and retry. If rotation fails, it clears the cookies and the client redirects to login.
- **change-password / logout-all:** the backend revokes all sessions, and the BFF clears the cookies.
- **Passkeys:** `features/auth/passkey.ts` wraps `@simplewebauthn/browser`. It sends the options/verify pair through `passkeysApi`.

### 3.5 Page anatomy (list page example: Users)

```text
<RequirePermission permission="users:read" context="tenant">
  <PageContainer>
    <PageHeader title actions=[Create button if can("users:create")] />
    <ContentCard>
      <SearchInput/> <FilterDropdown/>
      <DataTable columns rows sort onSort loading/empty/error />
      <Pagination meta onPageChange />
    </ContentCard>
    <UserFormDialog/>  <UserSheet/>  <ConfirmDialog/>
  </PageContainer>
</RequirePermission>
```

Data comes from `useUsers(listState.params)`. Writes go through `useUserMutations()`, which shows a toast and invalidates `["users"]`.

---

## 4. Contract between frontend and backend

| Aspect | Contract |
| --- | --- |
| Transport | Browser → `/api/<path>` (same origin) → BFF → `${API_URL}/<path>` |
| Envelope | `{ success, message, data, meta }`. Errors are `{ success:false, message, errors:[{field,message}], meta:{requestId} }` |
| Pagination | Query `page, limit, sort, order, search`. `meta: { page, limit, total, totalPages }` |
| Validation errors | 422 with `field` = `body.<name>`. The frontend strips the prefix and sets form errors |
| Identity & tenant | Only in the signed token. The frontend never sends a tenant id. It switches tenants through `auth/switch-tenant` |
| Permissions | The backend enforces them. The frontend reads `me.permissions` to hide UI |
| Tracing | `x-request-id` is forwarded both ways |
| Tenancy mode | `TENANCY_MODE` (backend) must match `NEXT_PUBLIC_TENANCY_MODE` (frontend) |

---

## 5. Security architecture summary

1. **Tokens never reach browser JS** (BFF and HttpOnly cookies), which limits what XSS can steal.
2. **Tenant isolation** comes from token-bound `tid`, `tenantScope`, 404s for foreign ids, and isolation tests.
3. **Immediate revocation:** each request re-validates against the DB, refresh rotation has reuse detection, and a password change revokes all sessions.
4. **Defence in depth on input:** Zod on every route, parameterized Knex, allow-listed sorting, body size limit.
5. **Abuse controls:** global and auth-specific rate limits, account lockout, and no account enumeration.
6. **Strong credentials:** Argon2id, a password policy, passkeys, and MFA with recovery codes.
7. **Opaque failures:** 5xx responses never leak internals, and every error carries a `requestId` for log correlation.

---

## 6. Deployment topology

```text
            ┌──────────── reverse proxy / TLS ────────────┐
            │                                              │
   Next.js (next start) ──API_URL──▶ Fastify API (Docker, node:22-alpine, non-root)
                                         │   HEALTHCHECK /health, SIGTERM drain
                                         ▼
                                  PostgreSQL 16 (volume pgdata)
                         Compose order: postgres(healthy) → migrate → api
```

- Configuration comes only from the environment. There are no secrets in images.
- Set backend `TRUST_PROXY=true` behind a proxy so per-IP rate limits see the real client IP. The BFF forwards `x-forwarded-for`.
- Scaling: the API is stateless and can scale horizontally. The Next BFF refresh dedupe is per instance (see §3.3).

---

## 7. Extension recipes

### Add a backend module (e.g. `employees`)
1. Migration with `tenant_id NOT NULL` FK (`npm run db:make -- create_employees`).
2. Permissions `EMPLOYEES_READ/…` in `shared/constants/permissions.ts`, added to `DEFAULT_TENANT_ROLES`, then `npm run db:seed`. Existing tenants need a data migration.
3. `employees.{schema,repository,service,controller,routes}.ts`. Repositories use `tenantScope`, and services use `requireTenantId`.
4. Register in `app.ts`: `api.register(employeesRoutes, { prefix: '/employees' })`.
5. Integration test including a **cross-tenant 404** case.

### Add the matching frontend feature
1. Types in `lib/api/types.ts`, and `employeesApi` in `lib/api/endpoints.ts`.
2. `features/employees/use-employees.ts` (queries and mutations, invalidate `["employees"]`).
3. `features/employees/employees-page.tsx`, built from `PageHeader` + `DataTable` + `useListState`.
4. `app/(app)/employees/page.tsx` renders the page inside `<RequirePermission permission="employees:read" context="tenant">`.
5. Nav item in `config/navigation.ts` with `permission` and `context`.
