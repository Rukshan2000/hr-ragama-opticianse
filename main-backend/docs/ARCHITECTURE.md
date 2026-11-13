# Architecture

## Principles

- **Feature modules.** Each module in `src/modules/` owns its routes, controller, service, repository and schemas. Modules talk to each other through services/repositories, never through HTTP.
- **Thin layers with one job each.**

| Layer      | File              | Responsibility                                                               | Must not               |
| ---------- | ----------------- | ---------------------------------------------------------------------------- | ---------------------- |
| Route      | `*.routes.ts`     | Path, method, Zod schemas, guards, OpenAPI tags                              | contain logic          |
| Controller | `*.controller.ts` | Read the request, call the service, shape the response                       | touch the DB           |
| Service    | `*.service.ts`    | Business rules, transactions, authorization decisions beyond the route guard | know about HTTP        |
| Repository | `*.repository.ts` | Knex queries, tenant scoping                                                 | contain business rules |
| Schema     | `*.schema.ts`     | Zod input schemas + inferred types                                           | —                      |

- **Composition, not a container.** Repositories and services are plain module-level objects. Tests replace them with `vi.mock`. If a module grows real variants (e.g. two mail providers), introduce an interface at that point, not before.
- **Small modules can skip layers.** `permissions` is a read-only catalog, so it uses a single route file. Add layers when the logic arrives.

## Request lifecycle

```text
request
 → genReqId (honours a sane x-request-id)       app.ts
 → helmet / cors / rate limit                   shared/plugins/security.ts
 → Zod validation of params/query/body          fastify-type-provider-zod
 → preHandler: authenticate → requirePermissions modules/auth/auth.guard.ts
 → controller → service → repository → PostgreSQL
 → sendSuccess() envelope                       shared/utils/response.ts
 ↳ any thrown error → central error handler     shared/plugins/error-handler.ts
```

`authenticate` verifies the JWT, then reloads the user, membership, tenant status and permissions from the DB (two parallel queries). Deactivations, role changes and removals take effect on the next request.

## Adding a module

Example: `projects`, owned by a tenant.

1. **Migration**: `npm run db:make -- create_projects` (see [MIGRATIONS.md](MIGRATIONS.md)) with a `tenant_id` FK.
2. **Permissions**: add `PROJECTS_READ: 'projects:read'` etc. to `src/shared/constants/permissions.ts` with a description. Add them to the relevant `DEFAULT_TENANT_ROLES`. Run `npm run db:seed` to sync the catalog.
3. **Files** in `src/modules/projects/`:

```ts
// projects.repository.ts
import { db, type DbExecutor } from '../../database/knex';
import { tenantScope } from '../../shared/utils/tenant-scope';

export const projectsRepository = {
  findById(tenantId: string, id: string, executor: DbExecutor = db) {
    return tenantScope(executor, 'projects', tenantId).where({ id }).first();
  },
};

// projects.service.ts
export const projectsService = {
  async get(auth: AuthContext, id: string) {
    const project = await projectsRepository.findById(requireTenantId(auth), id);
    if (!project) throw new NotFoundError('Project');
    return project;
  },
};

// projects.routes.ts
export const projectsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/:id',
    {
      preHandler: requirePermissions(P.PROJECTS_READ),
      schema: {
        tags: ['Projects'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.uuid() }),
      },
    },
    projectsController.get,
  );
};
```

4. **Register** in `src/app.ts`: `await api.register(projectsRoutes, { prefix: '/projects' });`
5. **Test**: add `tests/integration/projects.test.ts` using `setupTestApp()`. Include a cross-tenant 404 case.

## Adding an endpoint to an existing module

Add a Zod schema in `*.schema.ts`, a service method, a controller method, and one line in `*.routes.ts` with the right `requirePermissions(...)`. It appears in Swagger automatically.

## Dependency direction

`modules → shared → config`. `shared` never imports from `modules`. `auth.guard` lives in the auth module because it needs the auth repository.
