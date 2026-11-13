# API standards

## Versioning and paths

- Prefix: `API_PREFIX` (default `/api/v1`). Breaking changes go into a new prefix registered beside the old one in `app.ts`.
- Plural nouns for resources: `/users`, `/users/:id`, with sub-actions as `/users/:id/status`.
- Methods: `GET` read, `POST` create/action, `PATCH` partial update, `DELETE` remove.

## Response envelope

```json
{ "success": true, "message": "Operation completed successfully", "data": {}, "meta": null }
```

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [{ "field": "body.email", "message": "Invalid email address" }],
  "meta": { "requestId": "1b4e…" }
}
```

Use `sendSuccess(reply, data, { message, statusCode, meta })`. Throw errors and never format them by hand.

## Status codes and error classes

| Status | Class (`shared/errors/app-error.ts`) | When                                                                      |
| ------ | ------------------------------------ | ------------------------------------------------------------------------- |
| 400    | `BadRequestError`                    | Semantically invalid request, malformed JSON                              |
| 401    | `UnauthorizedError`                  | Missing/invalid/revoked credentials                                       |
| 403    | `ForbiddenError`                     | Authenticated but not allowed                                             |
| 404    | `NotFoundError`                      | Missing **or in another tenant**                                          |
| 409    | `ConflictError`                      | Unique conflicts (email, slug, role name)                                 |
| 413    | (Fastify)                            | Body over `BODY_LIMIT_BYTES`                                              |
| 422    | `ValidationError` / Zod              | Schema validation failed                                                  |
| 429    | `TooManyRequestsError`               | Rate limit or account lockout                                             |
| 500    | anything else                        | Logged with the request id. The client sees only "Internal server error". |

## Lists: pagination, sorting, filtering, search

```text
GET /api/v1/users?page=2&limit=20&sort=name&order=asc&search=ali&isActive=true
```

| Param    | Default      | Rules                                                                   |
| -------- | ------------ | ----------------------------------------------------------------------- |
| `page`   | 1            | ≥ 1                                                                     |
| `limit`  | 20           | 1–100                                                                   |
| `sort`   | per resource | allow-list only (`listQuerySchema(['name', 'createdAt'], 'createdAt')`) |
| `order`  | `desc`       | `asc` / `desc`                                                          |
| `search` | –            | case-insensitive `ILIKE`, wildcards escaped                             |
| filters  | –            | explicit per resource (e.g. `isActive`)                                 |

Response `meta`: `{ "page": 2, "limit": 20, "total": 57, "totalPages": 3 }`.

## Request IDs

Each request gets an id. A valid incoming `x-request-id` (for example from Nginx) is reused. The id appears in every log line, in the `x-request-id` response header, and in `meta.requestId` on errors.

## Naming

- JSON fields are `camelCase`. DB columns are `snake_case`. Mapping happens in the service DTO functions (`toUserDto`…), so DB columns never leak.
- Dates are ISO-8601 UTC strings.

## Documentation

OpenAPI is generated from the Zod schemas: `/docs` (UI) and `/docs/json`. It is enabled by default outside production. Set `SWAGGER_ENABLED=true` to expose it in production.
