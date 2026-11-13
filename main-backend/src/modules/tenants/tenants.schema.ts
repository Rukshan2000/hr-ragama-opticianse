import { z } from 'zod';
import { listQuerySchema } from '../../shared/utils/pagination';
import { passwordSchema } from '../../shared/utils/password';

export const tenantIdParams = z.object({ id: z.uuid() });

export const listTenantsQuery = listQuerySchema(['name', 'slug', 'createdAt'], 'createdAt').extend({
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

const slug = z
  .string()
  .min(2)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens');

export const createTenantBody = z.object({
  name: z.string().trim().min(2).max(150),
  slug: slug.optional(),
  owner: z
    .object({
      name: z.string().trim().min(1).max(150),
      email: z
        .email()
        .max(255)
        .transform((e) => e.toLowerCase()),
      password: passwordSchema,
    })
    .optional(),
});

export const updateTenantBody = z
  .object({ name: z.string().trim().min(2).max(150).optional(), isActive: z.boolean().optional() })
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update');

export type TenantIdParams = z.infer<typeof tenantIdParams>;
export type ListTenantsQuery = z.infer<typeof listTenantsQuery>;
export type CreateTenantBody = z.infer<typeof createTenantBody>;
export type UpdateTenantBody = z.infer<typeof updateTenantBody>;
