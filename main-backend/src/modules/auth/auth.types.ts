export interface UserCredentialsRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  is_active: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
}

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  tenant_id: string | null;
  family_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by_id: string | null;
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
}

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}
