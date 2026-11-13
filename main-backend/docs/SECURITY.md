# Security

## Controls in place

| Area                 | Control                                                                                                              | Where                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Headers              | Helmet (CSP when Swagger is off, nosniff, frameguard, HSTS…)                                                         | `shared/plugins/security.ts` |
| CORS                 | Explicit origin allow-list (`CORS_ORIGIN`, comma-separated)                                                          | same                         |
| Rate limiting        | Global `RATE_LIMIT_MAX`/window. Stricter limit on credential endpoints.                                              | same, `auth.routes.ts`       |
| Brute force          | Per-account lockout plus a constant-time path for unknown emails                                                     | `auth.service.ts`            |
| Body size            | `BODY_LIMIT_BYTES` (1 MiB)                                                                                           | `app.ts`                     |
| Input                | Zod on every param, query and body. Sort fields are allow-listed.                                                    | `*.schema.ts`                |
| SQL injection        | Knex parameter binding only. LIKE wildcards escaped.                                                                 | repositories                 |
| Passwords            | Argon2id, policy, never selected outside auth queries                                                                | `shared/utils/password.ts`   |
| Tokens               | Short-lived JWT pinned to HS256/iss/aud. Refresh tokens stored as HMAC hashes, rotated, reuse-detected.              | `token.service.ts`           |
| Revocation           | Per-request DB check of user, membership, tenant and password change                                                 | `auth.guard.ts`              |
| Privilege escalation | Assigning roles needs `roles:manage`. No self-role or self-status changes. Platform perms cannot go on tenant roles. | services/schemas             |
| Tenant isolation     | Tenant from the signed token only; `tenantScope` on queries                                                          | see MULTITENANCY.md          |
| Error leakage        | 5xx messages are generic. Stack traces and SQL appear only in logs.                                                  | `error-handler.ts`           |
| Logs                 | Redaction of `authorization`, cookies, passwords, tokens                                                             | `config/logger.ts`           |
| Config               | Zod-validated env, secrets ≥ 32 chars, fail fast                                                                     | `config/env.ts`              |
| Container            | Non-root user, prod deps only, no secrets in the image                                                               | `Dockerfile`                 |

## Reverse proxy

Behind Nginx set `TRUST_PROXY=true`, so `req.ip` (used by rate limiting and session metadata) comes from `X-Forwarded-For`. Only do this when the app port is reachable **only** through the proxy, because otherwise clients can spoof their IP.

## Cookies

The API returns tokens in JSON and sets no cookies. If you add cookie-based refresh, use `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` and add CSRF protection for state-changing cookie-authenticated routes.

## Production checklist

- [ ] Unique random `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (48+ bytes), stored in a secret manager or a root-only `.env`
- [ ] `NODE_ENV=production`, `LOG_LEVEL=info`
- [ ] `CORS_ORIGIN` set to real front-end origins (no `*`)
- [ ] `DB_SSL=true` if the DB is not on a private network. The app DB user has least privilege.
- [ ] TLS terminated at Nginx, HTTP redirected to HTTPS
- [ ] Mail delivery implemented in `shared/utils/mailer.ts`
- [ ] Redis store for `@fastify/rate-limit` if you run more than one instance
- [ ] `npm run audit` in CI, Dependabot/Renovate enabled
- [ ] Database backups scheduled and restore tested

## Dependency audit

`npm run audit` checks production dependencies. Known at the time of writing: moderate advisories in `glob`/`minimatch`, pulled in through `@fastify/swagger-ui` → `@fastify/static`. They affect glob patterns, not request handling. Swagger UI is disabled in production by default, which keeps this code path off live servers.

## Reporting

Add your security contact and disclosure policy here.
