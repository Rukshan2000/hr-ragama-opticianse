# Claude Code Prompt: Production-Ready Node.js Backend Boilerplate

Act as a Senior Backend Architect and DevOps Engineer. Your task is to design and implement a professional, scalable, secure, production-ready Node.js backend boilerplate.

The project must be a reusable backend foundation for building SaaS applications, ERP systems, LMS platforms, accounting software, CRM systems, and enterprise applications.

Do not create a simple CRUD demo. Build a properly structured backend architecture that can support long-term development and production deployment.

## 1. Technology Stack

Use the following technologies:

- **Runtime:** Node.js (LTS)
- **Language:** TypeScript
- **Framework:** Fastify
- **Database:** PostgreSQL
- **Query Builder:** Knex.js
- **Migration System:** Knex Migrations
- **Validation:** Zod
- **Authentication:** JWT
- **Password Hashing:** Argon2
- **Logging:** Pino
- **API Documentation:** Swagger / OpenAPI
- **Testing:** Vitest
- **Containerization:** Docker and Docker Compose
- **Package Manager:** npm

Use stable, compatible package versions. Avoid unnecessary dependencies.

## 2. Architecture and Project Structure

Create a clean, modular, feature-based architecture.

Suggested structure:

```text
src/
├── app.ts
├── server.ts
│
├── config/
│   ├── env.ts
│   ├── database.ts
│   ├── logger.ts
│   └── app.config.ts
│
├── database/
│   ├── knex.ts
│   ├── migrations/
│   ├── seeds/
│   └── factories/
│
├── modules/
│   ├── auth/
│   │   ├── auth.routes.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── auth.repository.ts
│   │   ├── auth.schema.ts
│   │   └── auth.types.ts
│   │
│   ├── users/
│   ├── roles/
│   ├── permissions/
│   └── health/
│
├── shared/
│   ├── errors/
│   ├── middleware/
│   ├── plugins/
│   ├── types/
│   ├── utils/
│   ├── constants/
│   └── helpers/
│
└── tests/
    ├── unit/
    └── integration/

scripts/
docs/
```

You can improve this structure if you identify a better architectural approach.

Keep responsibilities separated:

- Routes: API endpoint definitions.
- Controllers: HTTP request and response handling.
- Services: Business logic.
- Repositories: Database operations.
- Schemas: Input validation.
- Types: TypeScript definitions.

Avoid putting business logic inside controllers or database queries directly inside routes.

## 3. PostgreSQL and Knex Migration Architecture

This is one of the most important requirements.

Implement a professional database management system using Knex.js.

Requirements:

- Centralized Knex database configuration.
- Version-controlled migrations.
- Reusable migration conventions.
- Database transaction support.
- Reusable database connection.
- Development and production database configurations.
- Migration rollback support.
- Database seeding.
- Migration status checking.
- Consistent naming conventions.
- Proper indexes and foreign keys.
- UUID primary keys.
- Created and updated timestamps.
- Soft delete support where appropriate.

Create useful npm commands:

```bash
npm run db:migrate
npm run db:rollback
npm run db:status
npm run db:seed
npm run db:make
```

Example migration:

```typescript
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table.string('name', 150).notNullable();
    table.string('email', 255).notNullable().unique();
    table.string('password_hash').notNullable();

    table.boolean('is_active').notNullable().defaultTo(true);

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('users');
}
```

This is only an example. Implement proper production migration conventions.

Important:

- Never modify an already-applied migration to introduce schema changes.
- Create new migrations for schema updates.
- Do not automatically run destructive migrations in production.
- Ensure database transactions are used for operations that require atomicity.
- Use a migration lock and document safe deployment procedures.
- Avoid unnecessary database queries and N+1 problems.

## 4. Authentication and Authorization

Implement a complete authentication foundation.

Features:

- User registration.
- User login.
- Logout.
- Access token.
- Refresh token.
- Refresh token rotation.
- Token revocation.
- Password hashing with Argon2.
- Forgot password foundation.
- Password reset.
- Change password.
- Get authenticated user profile.
- Account activation/deactivation.

Security requirements:

- Store refresh tokens securely as hashes in the database.
- Implement refresh token reuse detection.
- Use short-lived access tokens.
- Never store plaintext passwords.
- Never expose password hashes in API responses.
- Add authentication guards.
- Add role-based access control (RBAC).
- Support granular permissions.

Create initial roles and permissions:

- Super Admin
- Admin
- Manager
- User

Do not hardcode permission checks throughout the application. Create reusable authorization utilities.

## 5. Multi-Tenant SaaS Readiness

Prepare the architecture for future multi-tenant SaaS development.

Use a shared PostgreSQL database and shared schema with tenant isolation through `tenant_id`.

Requirements:

- Tenant management module.
- Tenant identification.
- Tenant context handling.
- Tenant-aware repository patterns.
- Tenant-scoped database queries.
- Tenant-aware authentication.
- Tenant-specific roles and permissions.
- Prevent cross-tenant data access.

Important:

- Do not introduce unnecessary complexity.
- Platform-level users and tenant-level users should be handled separately.
- Do not trust tenant IDs supplied by clients.
- Derive tenant access from authenticated context and validate membership.
- Consider PostgreSQL Row-Level Security as an additional security layer, but do not enable it without a correct connection and transaction context strategy.

## 6. API Standards

Create consistent REST API conventions.

Example endpoints:

```text
/api/v1/auth/register
/api/v1/auth/login
/api/v1/auth/refresh
/api/v1/auth/logout
/api/v1/auth/me

/api/v1/users
/api/v1/users/:id

/api/v1/roles
/api/v1/permissions

/api/v1/health
/api/v1/health/ready
```

Standard response format:

Success:

```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {},
  "meta": null
}
```

Error:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [],
  "meta": null
}
```

Implement:

- Centralized exception handling.
- Standard HTTP status codes.
- Request validation.
- Pagination.
- Sorting.
- Filtering.
- Search.
- API versioning.
- Request ID tracking.
- Consistent response formatting.

## 7. Security

Implement production-level security practices.

- Helmet security headers.
- CORS configuration.
- Rate limiting.
- Request body size limits.
- Input validation.
- SQL injection protection through Knex parameterization.
- Secure cookie configuration where cookies are used.
- Environment variable validation.
- Password policy.
- Brute-force login protection.
- Avoid sensitive information in logs.
- Prevent stack traces from leaking in production.
- Secure HTTP configuration behind reverse proxies.
- Dependency security auditing.

Never expose internal database errors or secrets to API clients.

## 8. Logging and Monitoring

Implement structured logging using Pino.

Include:

- Request logging.
- Error logging.
- Request correlation IDs.
- Response time.
- Database connection errors.
- Application startup and shutdown logs.

Implement:

```text
GET /api/v1/health
GET /api/v1/health/ready
```

Readiness should verify actual database connectivity.

Implement graceful shutdown for HTTP connections and PostgreSQL.

## 9. Testing

Set up Vitest.

Implement:

- Unit testing.
- Service testing.
- Repository integration testing.
- API integration testing.
- Authentication testing.
- Authorization testing.
- Tenant isolation testing.
- Validation testing.
- Error handling testing.

Use a separate PostgreSQL test database.

Tests must not affect development or production data.

Provide commands:

```bash
npm run test
npm run test:unit
npm run test:integration
npm run test:coverage
```

## 10. Docker and Deployment

Create a production-ready Docker setup.

Required files:

```text
Dockerfile
Dockerfile.dev
docker-compose.yml
docker-compose.dev.yml
.dockerignore
.env.example
```

Docker Compose should support:

- Node.js API.
- PostgreSQL.
- Persistent PostgreSQL volumes.
- Health checks.
- Environment configuration.

Production requirements:

- Multi-stage Docker build.
- Non-root container user.
- Production-only dependencies.
- Small image size.
- Proper signal handling.
- No secrets inside Docker images.

Provide deployment documentation for a Linux VPS using Docker and Nginx.

## 11. Environment Configuration

Create a properly validated `.env.example`.

Include:

```env
NODE_ENV=development
PORT=5000
API_PREFIX=/api/v1

APP_NAME=Backend API
APP_URL=http://localhost:5000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=app_db
DB_USER=postgres
DB_PASSWORD=password

JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

CORS_ORIGIN=http://localhost:3000

LOG_LEVEL=debug
```

Use Zod to validate environment variables at application startup.

Never commit real credentials.

## 12. Developer Experience

Make the boilerplate easy to maintain and extend.

Provide:

- TypeScript strict mode.
- ESLint.
- Prettier.
- Husky.
- lint-staged.
- Consistent naming conventions.
- Clear error classes.
- Reusable utility functions.
- Reusable pagination helpers.
- Reusable validation helpers.
- Database transaction helpers.
- Typed environment configuration.

Create useful scripts:

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run format
npm run typecheck
npm run test
```

## 13. Documentation

Create comprehensive documentation.

Required:

```text
README.md
docs/
├── ARCHITECTURE.md
├── DATABASE.md
├── MIGRATIONS.md
├── AUTHENTICATION.md
├── AUTHORIZATION.md
├── MULTITENANCY.md
├── API_STANDARDS.md
├── SECURITY.md
├── TESTING.md
└── DEPLOYMENT.md
```

Explain how developers can:

- Install the project.
- Configure PostgreSQL.
- Run migrations.
- Roll back migrations.
- Create a new module.
- Add a new API endpoint.
- Add a database table.
- Implement authentication.
- Add roles and permissions.
- Run tests.
- Build and deploy the application.

## 14. Implementation Guidelines

Follow these rules throughout development:

1. Build a maintainable architecture, not an unnecessarily complicated enterprise framework.
2. Use TypeScript properly. Avoid `any` wherever possible.
3. Use Knex.js for database operations.
4. Keep migrations independent and reversible where practical.
5. Avoid duplicated business logic.
6. Use dependency injection or a lightweight modular composition approach where beneficial.
7. Avoid circular dependencies.
8. Avoid unnecessary abstractions.
9. Keep modules independent and reusable.
10. Follow SOLID principles where they genuinely improve maintainability.
11. Do not introduce Prisma, TypeORM, Sequelize, or another ORM.
12. Do not use MongoDB.
13. Do not create mock implementations for core functionality.
14. Do not leave TODO placeholders for essential functionality.

## 15. Final Deliverables

Build the actual working project in the current repository.

Do not just generate an architecture document or explain what should be done.

Your workflow:

**Phase 1:** Inspect the current repository and understand its state.

**Phase 2:** Design the architecture and create the project structure.

**Phase 3:** Implement configuration, PostgreSQL, and Knex migration infrastructure.

**Phase 4:** Implement authentication, authorization, and tenant foundations.

**Phase 5:** Implement API standards, security, logging, and health checks.

**Phase 6:** Implement Docker, testing, and developer tooling.

**Phase 7:** Write comprehensive documentation.

**Phase 8:** Install dependencies, run migrations against a test database, execute tests, run linting, and verify the production build.

Fix all errors before considering the project complete.

### Definition of Done

The project must:

- Start successfully.
- Connect to PostgreSQL.
- Run and roll back migrations.
- Support database seeding.
- Register and authenticate users.
- Support refresh token rotation and revocation.
- Enforce roles and permissions.
- Have a tenant-isolation foundation.
- Validate API requests.
- Return consistent API responses.
- Generate Swagger documentation.
- Pass automated tests.
- Build successfully.
- Run through Docker Compose.
- Have complete developer documentation.

**Final objective:** Deliver a clean, secure, scalable Node.js backend boilerplate that can be cloned and reused as the starting point for multiple production SaaS applications. Prioritize maintainability, database integrity, security, and developer experience.
