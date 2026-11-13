import { z } from 'zod';
import { TENANT_PERMISSIONS } from '../../shared/constants/permissions';
import { listQuerySchema } from '../../shared/utils/pagination';

export const roleIdParams = z.object({ id: z.uuid() });

export const listRolesQuery = listQuerySchema(['name', 'createdAt'], 'name');

// Tenant roles can only carry tenant-scoped permissions; platform ones are never assignable here.
const permissions = z.array(z.enum(TENANT_PERMISSIONS)).max(100);

export const createRoleBody = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(255).nullish(),
  permissions,
});

export const updateRoleBody = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(255).nullish(),
    permissions: permissions.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update');

export type RoleIdParams = z.infer<typeof roleIdParams>;
export type ListRolesQuery = z.infer<typeof listRolesQuery>;
export type CreateRoleBody = z.infer<typeof createRoleBody>;
export type UpdateRoleBody = z.infer<typeof updateRoleBody>;
