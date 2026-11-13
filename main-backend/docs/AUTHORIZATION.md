# Authorization

RBAC with granular permissions. Permission keys are `resource:action`.

## Model

- **Permissions**: defined once in `src/shared/constants/permissions.ts` and synced to the DB by the seed.
- **Roles** have many permissions. `roles.tenant_id IS NULL` means a **platform role**; otherwise the role belongs to one tenant.
- **Users** have roles (`user_roles`). Permissions are evaluated **per context**:
  - tenant session → only that tenant's roles count
  - platform session (`tid = null`) → only platform roles count

A Super Admin therefore has no implicit power inside tenants, and tenant admins can never reach platform endpoints.

## Built-in roles

| Role        | Scope       | Permissions                                                  |
| ----------- | ----------- | ------------------------------------------------------------ |
| Super Admin | platform    | everything, including `tenants:read/manage`                  |
| Admin       | each tenant | all tenant permissions                                       |
| Manager     | each tenant | `users:read/create/update`, `roles:read`, `permissions:read` |
| User        | each tenant | `users:read`                                                 |

Tenant roles are created for every new tenant (`DEFAULT_TENANT_ROLES`). They are `is_system` (they can be edited but not deleted). Tenants can create custom roles through `/roles`. Platform permissions are rejected for tenant roles.

## Guarding routes

```ts
app.post('/', { preHandler: requirePermissions(P.USERS_CREATE), schema }, handler);
```

`requirePermissions(...perms)` authenticates and requires **all** listed permissions. Don't check permission strings in handlers. For a rule that depends on data, put it in the service. For example, `resolveRoleIds` requires `roles:manage` to assign roles, which stops a Manager from granting themselves Admin.

Other built-in guardrails: users cannot change their own roles or status, or remove themselves.

## Adding a permission

1. Add the key to `PERMISSIONS` and `PERMISSION_DESCRIPTIONS`.
2. Add it to the right entries of `DEFAULT_TENANT_ROLES` / `PLATFORM_ROLES`.
3. `npm run db:seed` (idempotent). This updates the catalog and platform roles.
4. **Existing tenants' roles are not changed automatically**, because tenants may have customized them. Grant the new permission with a data migration if needed:

```ts
await knex.raw(`
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r, permissions p
  WHERE r.slug = 'admin' AND r.tenant_id IS NOT NULL AND p.key = 'projects:read'
  ON CONFLICT DO NOTHING`);
```

## Adding a role

- Tenant-wide default for new tenants: add it to `DEFAULT_TENANT_ROLES`.
- Per tenant, at runtime: `POST /api/v1/roles { name, description, permissions: [...] }`.
- Platform role: add it to `PLATFORM_ROLES` and seed.
