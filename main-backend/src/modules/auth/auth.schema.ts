import { z } from 'zod';
import { appConfig } from '../../config/app.config';
import { passwordSchema } from '../../shared/utils/password';

const email = z
  .email()
  .max(255)
  .transform((e) => e.toLowerCase());

export const registerBody = z.object({
  name: z.string().trim().min(1).max(150),
  email,
  password: passwordSchema,
  // Single-tenant mode has no organizations to create.
  organizationName: appConfig.tenancy.single
    ? z.string().trim().min(2).max(150).optional()
    : z.string().trim().min(2).max(150),
});

export const loginBody = z.object({
  email,
  password: z.string().min(1).max(128),
  tenantSlug: z.string().trim().min(1).max(100).optional(),
});

export const refreshBody = z.object({ refreshToken: z.string().min(20).max(200) });

export const switchTenantBody = z.object({ tenantSlug: z.string().trim().min(1).max(100) });

export const changePasswordBody = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })
  .refine((b) => b.currentPassword !== b.newPassword, {
    message: 'New password must differ from the current one',
    path: ['newPassword'],
  });

export const forgotPasswordBody = z.object({ email });

export const resetPasswordBody = z.object({
  token: z.string().min(20).max(200),
  newPassword: passwordSchema,
});

export type RegisterBody = z.infer<typeof registerBody>;
export type LoginBody = z.infer<typeof loginBody>;
export type RefreshBody = z.infer<typeof refreshBody>;
export type SwitchTenantBody = z.infer<typeof switchTenantBody>;
export type ChangePasswordBody = z.infer<typeof changePasswordBody>;
export type ForgotPasswordBody = z.infer<typeof forgotPasswordBody>;
export type ResetPasswordBody = z.infer<typeof resetPasswordBody>;
