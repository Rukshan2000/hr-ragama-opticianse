# Authentication

## Tokens

|          | Access token                                      | Refresh token                                                          |
| -------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| Format   | JWT HS256 (`iss`, `aud=api`, `sub`, `tid`, `typ`) | 256-bit random, opaque                                                 |
| Lifetime | `JWT_ACCESS_EXPIRES_IN` (15m)                     | `JWT_REFRESH_EXPIRES_IN` (7d)                                          |
| Stored   | nowhere (stateless)                               | `refresh_tokens.token_hash` = HMAC-SHA256(token, `JWT_REFRESH_SECRET`) |
| Sent as  | `Authorization: Bearer …`                         | JSON body to `/auth/refresh` and `/auth/logout`                        |

`tid` is the tenant the session is bound to (`null` = platform context).

Even though access tokens are stateless, every request still checks the database: the user must be active and not deleted, the membership and tenant must be active, and the token must be newer than `password_changed_at`. Revocations therefore apply immediately.

## Endpoints (`/api/v1/auth`)

| Method | Path               | Auth   | Purpose                                                      |
| ------ | ------------------ | ------ | ------------------------------------------------------------ |
| POST   | `/register`        | –      | Create user + organization (tenant). User becomes its Admin. |
| POST   | `/login`           | –      | `{ email, password, tenantSlug? }`                           |
| POST   | `/refresh`         | –      | Rotate the refresh token, get a new pair                     |
| POST   | `/logout`          | –      | Revoke this session (token family)                           |
| POST   | `/logout-all`      | Bearer | Revoke every session of the user                             |
| POST   | `/switch-tenant`   | Bearer | New session for another tenant the user belongs to           |
| GET    | `/me`              | Bearer | Profile, current tenant, all tenants, roles, permissions     |
| POST   | `/change-password` | Bearer | Needs the current password. Revokes all sessions.            |
| POST   | `/forgot-password` | –      | Always the same response (no email probing)                  |
| POST   | `/reset-password`  | –      | `{ token, newPassword }`, single-use token                   |

### Login tenant selection

- With `tenantSlug`: the user must be an active member of that tenant (403 otherwise).
- Without it, and exactly one membership: logged into that tenant.
- Otherwise: platform-context session. Use the returned `tenants` list with `/auth/switch-tenant`.

## Refresh token rotation and reuse detection

```text
login ──> R1 (family F)
refresh(R1) ──> R2 (F); R1 revoked, replaced_by = R2
refresh(R2) ──> R3 (F); R2 revoked …
refresh(R1) again  ⇒ R1 is revoked AND was replaced ⇒ token theft ⇒ revoke all of F ⇒ 401
```

The token row is locked with `SELECT … FOR UPDATE`, so two concurrent refreshes cannot both succeed. Clients must serialize refreshes, for example with a single in-flight refresh promise.

## Passwords

- Argon2id, OWASP parameters (19 MiB, t=2, p=1).
- Policy (`passwordSchema`): 10–128 chars, upper, lower, digit.
- Unknown emails still run a dummy verification, so response timing does not reveal which accounts exist.
- Lockout: after `LOGIN_MAX_ATTEMPTS` failures the account is locked for `LOGIN_LOCKOUT_MINUTES` (429). The counter increments atomically in SQL. Auth endpoints also get a stricter per-IP rate limit (`AUTH_RATE_LIMIT_MAX`/min).

## Password reset delivery

`authService.requestPasswordReset` creates the token, invalidates older ones and calls `sendPasswordResetEmail` in `src/shared/utils/mailer.ts`. In development the link is logged. **Before going live, implement delivery in that one function** with your SMTP/API provider. The rest of the flow is complete.

## Client integration

1. Store the access token in memory. Store the refresh token in secure storage. In browsers, prefer having a BFF put it in an `HttpOnly; Secure; SameSite=Strict` cookie.
2. On a 401 from an API call, call `/auth/refresh` once, retry the request, and on failure send the user to login.
3. On logout, call `/auth/logout` with the refresh token.
