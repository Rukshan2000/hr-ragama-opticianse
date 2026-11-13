import { z } from 'zod';
import { listQuerySchema } from '../../shared/utils/pagination';
import { passwordSchema } from '../../shared/utils/password';

export const userIdParams = z.object({ id: z.uuid() });

export const listUsersQuery = listQuerySchema(['name', 'email', 'createdAt'], 'createdAt').extend({
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

const roleIds = z.array(z.uuid()).max(20);

export const createUserBody = z.object({
  name: z.string().trim().min(1).max(150),
  email: z
    .email()
    .max(255)
    .transform((e) => e.toLowerCase()),
  password: passwordSchema,
  roleIds: roleIds.optional(),
});

export const updateUserBody = z
  .object({ name: z.string().trim().min(1).max(150).optional(), roleIds: roleIds.optional() })
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update');

export const userStatusBody = z.object({ isActive: z.boolean() });

export type UserIdParams = z.infer<typeof userIdParams>;
export type ListUsersQuery = z.infer<typeof listUsersQuery>;
export type CreateUserBody = z.infer<typeof createUserBody>;
export type UpdateUserBody = z.infer<typeof updateUserBody>;
export type UserStatusBody = z.infer<typeof userStatusBody>;
