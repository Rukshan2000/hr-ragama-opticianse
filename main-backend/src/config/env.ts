import { existsSync } from 'node:fs';
import { z } from 'zod';

// Real environment variables always win; the file only fills gaps (loadEnvFile never overrides).
const envFile = process.env.ENV_FILE ?? (process.env.NODE_ENV === 'test' ? '.env.test' : '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const duration = z.string().regex(/^\d+[smhd]$/, 'Use a duration like 15m, 12h or 7d');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(5000),
  API_PREFIX: z.string().startsWith('/').default('/api/v1'),
  APP_NAME: z.string().default('Backend API'),
  APP_URL: z.url().default('http://localhost:5000'),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(''),
  DB_SSL: bool.default(false),
  DB_POOL_MIN: z.coerce.number().int().nonnegative().default(0),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: duration.default('15m'),
  JWT_REFRESH_EXPIRES_IN: duration.default('7d'),
  PASSWORD_RESET_EXPIRES_IN: duration.default('30m'),

  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  TRUST_PROXY: bool.default(false),
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1_048_576),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

  // multi: self-service orgs, users can belong to many tenants. single: one built-in tenant for everyone.
  TENANCY_MODE: z.enum(['multi', 'single']).default('multi'),
  DEFAULT_TENANT_NAME: z.string().min(2).default('Default'),
  DEFAULT_TENANT_SLUG: z.string().min(1).default('default'),

  // Passkeys (WebAuthn). RP_ID must be the origin's hostname or a registrable suffix of it.
  RP_NAME: z.string().min(1).optional(),
  RP_ID: z.string().min(1).default('localhost'),
  EXPECTED_ORIGIN: z.string().default('http://localhost:3000'),
  PASSKEY_CHALLENGE_TTL: z.coerce.number().int().min(30).max(600).default(300),
  PASSKEY_USER_VERIFICATION: z.enum(['required', 'preferred']).default('required'),

  // Encrypts TOTP secrets at rest. Optional: derived from JWT_REFRESH_SECRET when unset.
  MFA_ENCRYPTION_KEY: z.string().min(32).optional(),
  MFA_TOKEN_TTL: z.coerce.number().int().min(60).max(1800).default(600),

  // Private object storage (MinIO/S3). Unset MINIO_ENDPOINT = in-memory store (tests only).
  MINIO_ENDPOINT: z.string().min(1).optional(),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: bool.default(false),
  MINIO_ROOT_USER: z.string().default(''),
  MINIO_ROOT_PASSWORD: z.string().default(''),
  MINIO_BUCKET: z.string().min(3).default('hr-ragama-opticians'),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),

  // Accounting (Invobiz) integration: base API URL (…/api/v1) and the shared HMAC secret
  // (= HR_PAYROLL_SECRET there). Unset = integration off.
  ACCOUNTING_API_URL: z.string().url().optional(),
  ACCOUNTING_SHARED_SECRET: z.string().min(32).optional(),
  SWAGGER_ENABLED: bool.optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:\n' + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
