import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendSuccess } from '../../shared/utils/response';
import { authService } from './auth.service';
import { hubLogin, hubLogout, hubProvision } from './hub.service';
import { hubSync } from './hub-sync';
import type {
  ChangePasswordBody,
  ForgotPasswordBody,
  LoginBody,
  RefreshBody,
  RegisterBody,
  ResetPasswordBody,
  SwitchTenantBody,
} from './auth.schema';
import type { ClientInfo } from './auth.types';

type Req<B> = FastifyRequest<{ Body: B }>;

const client = (req: FastifyRequest): ClientInfo => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'],
});

export const authController = {
  async register(req: Req<RegisterBody>, reply: FastifyReply) {
    const data = await authService.register(req.body, client(req));
    return sendSuccess(reply, data, { statusCode: 201, message: 'Registration successful' });
  },

  async login(req: Req<LoginBody>, reply: FastifyReply) {
    return sendSuccess(reply, await authService.login(req.body, client(req)), {
      message: 'Login successful',
    });
  },

  async hub(req: Req<{ token: string }>, reply: FastifyReply) {
    return sendSuccess(reply, await hubLogin(req.body.token, client(req)), {
      message: 'Login successful',
    });
  },

  async hubSync(req: Req<{ token: string; data: string }>, reply: FastifyReply) {
    return sendSuccess(reply, await hubSync(req.body.token, req.body.data), { message: 'Synced' });
  },

  async hubProvision(req: Req<{ token: string }>, reply: FastifyReply) {
    return sendSuccess(reply, await hubProvision(req.body.token), { message: 'Provisioned' });
  },

  async hubLogout(req: Req<{ token: string }>, reply: FastifyReply) {
    await hubLogout(req.body.token);
    return sendSuccess(reply, null, { message: 'Signed out' });
  },

  async refresh(req: Req<RefreshBody>, reply: FastifyReply) {
    return sendSuccess(reply, await authService.refresh(req.body.refreshToken, client(req)), {
      message: 'Token refreshed',
    });
  },

  async switchTenant(req: Req<SwitchTenantBody>, reply: FastifyReply) {
    const data = await authService.switchTenant(req.auth!.userId, req.body.tenantSlug, client(req));
    return sendSuccess(reply, data, { message: 'Tenant switched' });
  },

  async logout(req: Req<RefreshBody>, reply: FastifyReply) {
    await authService.logout(req.body.refreshToken);
    return sendSuccess(reply, null, { message: 'Logged out' });
  },

  async logoutAll(req: FastifyRequest, reply: FastifyReply) {
    await authService.logoutAll(req.auth!.userId);
    return sendSuccess(reply, null, { message: 'All sessions revoked' });
  },

  async me(req: FastifyRequest, reply: FastifyReply) {
    const { userId, tenantId, permissions } = req.auth!;
    return sendSuccess(reply, await authService.me(userId, tenantId, permissions));
  },

  async changePassword(req: Req<ChangePasswordBody>, reply: FastifyReply) {
    await authService.changePassword(
      req.auth!.userId,
      req.body.currentPassword,
      req.body.newPassword,
    );
    return sendSuccess(reply, null, { message: 'Password changed; please log in again' });
  },

  async forgotPassword(req: Req<ForgotPasswordBody>, reply: FastifyReply) {
    await authService.requestPasswordReset(req.body.email);
    return sendSuccess(reply, null, {
      message: 'If the email is registered, a reset link has been sent',
    });
  },

  async resetPassword(req: Req<ResetPasswordBody>, reply: FastifyReply) {
    await authService.resetPassword(req.body.token, req.body.newPassword);
    return sendSuccess(reply, null, { message: 'Password has been reset' });
  },
};
