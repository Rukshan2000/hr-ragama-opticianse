# Jeewaka — Frontend

Next.js 16 (App Router) + Tailwind v4 + shadcn/ui (Base UI) + TanStack Query, built against `../main-backend`.

## Run
```bash
cp .env.example .env.local   # API_URL points at the Fastify API
npm install
npm run dev                  # http://localhost:3000
```
Checks: `npm run lint && npm run typecheck && npm run build`.

## How auth works
The browser never sees a token. Every request goes to the same-origin BFF route `src/app/api/[...path]/route.ts`, which:
- forwards to `API_URL` and adds `Authorization: Bearer` from an **HttpOnly** cookie;
- removes tokens from login/register/switch-tenant responses and stores them in HttpOnly cookies;
- on 401, rotates the refresh token once (concurrent requests share that rotation, so reuse detection doesn't fire) and retries.

`src/proxy.ts` redirects pages based on whether the session cookie exists; the backend still enforces every permission.

**Backend note:** all API calls now come from the Next server. Set `TRUST_PROXY=true` on the backend so its per-IP rate limits use the forwarded client IP instead of treating every user as one IP.

## Theming
All colors live in `src/config/colors.json` (light + dark). `src/config/theme.ts` turns them into CSS variables that every component uses. Change the brand there; components contain no hard-coded colors.

## Layout
- `src/lib/api/` — fetch client, endpoint functions, response types (matching the backend DTOs)
- `src/components/shared/` — DataTable, Pagination, SearchInput, FilterDropdown, FormField, StatusBadge, ConfirmDialog, ActionDropdown, states, page primitives
- `src/components/layout/` — sidebar (collapsible, grouped, organization switcher), header (breadcrumbs, ⌘K search, theme, profile)
- `src/features/*` — auth, dashboard, users, roles, permissions, tenants, settings
- `src/config/navigation.ts` — navigation that shows or hides items based on permissions and the current context (organization or platform)
