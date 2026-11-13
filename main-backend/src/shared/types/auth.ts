import type { Permission } from '../constants/permissions';

/** Resolved on every authenticated request from the DB, never trusted from the token alone. */
export interface AuthContext {
  userId: string;
  email: string;
  /** null = platform context (no tenant selected). */
  tenantId: string | null;
  permissions: Set<Permission>;
}

export interface AccessTokenPayload {
  sub: string;
  tid: string | null;
  typ: 'access';
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}
