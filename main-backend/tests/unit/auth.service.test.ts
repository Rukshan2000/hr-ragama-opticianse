import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/modules/auth/auth.repository', () => ({
  authRepository: {
    findCredentialsByEmail: vi.fn(),
    recordFailedLogin: vi.fn(),
    recordSuccessfulLogin: vi.fn(),
    findActiveTenantsForUser: vi.fn(),
  },
}));
vi.mock('../../src/modules/auth/mfa.service', () => ({
  mfaService: { beginIfRequired: vi.fn(async () => null) },
}));
vi.mock('../../src/modules/auth/token.service', () => ({
  issueTokens: vi.fn(async () => ({
    accessToken: 'a',
    refreshToken: 'r',
    tokenType: 'Bearer',
    expiresIn: 900,
    refreshTokenId: 'id',
  })),
  hashRefreshToken: vi.fn(),
}));

import { authRepository } from '../../src/modules/auth/auth.repository';
import { authService } from '../../src/modules/auth/auth.service';
import { hashPassword } from '../../src/shared/utils/password';

const repo = vi.mocked(authRepository);
let user: Awaited<ReturnType<typeof authRepository.findCredentialsByEmail>>;

beforeEach(async () => {
  vi.clearAllMocks();
  user = {
    id: 'u1',
    name: 'U',
    email: 'u@x.com',
    password_hash: await hashPassword('Password123!'),
    is_active: true,
    failed_login_attempts: 0,
    locked_until: null,
  };
  repo.findCredentialsByEmail.mockResolvedValue(user);
  repo.findActiveTenantsForUser.mockResolvedValue([{ id: 't1', name: 'T', slug: 't' }]);
});

describe('authService.login', () => {
  it('auto-selects the only tenant', async () => {
    const res = await authService.login({ email: 'u@x.com', password: 'Password123!' }, {});
    expect('tenant' in res && res.tenant).toEqual({ id: 't1', name: 'T', slug: 't' });
    expect(repo.recordSuccessfulLogin).toHaveBeenCalledWith('u1');
  });

  it('records a failure on wrong password', async () => {
    await expect(authService.login({ email: 'u@x.com', password: 'nope' }, {})).rejects.toThrow(
      'Invalid email or password',
    );
    expect(repo.recordFailedLogin).toHaveBeenCalledOnce();
  });

  it('rejects locked accounts before checking the password', async () => {
    user!.locked_until = new Date(Date.now() + 60_000);
    await expect(
      authService.login({ email: 'u@x.com', password: 'Password123!' }, {}),
    ).rejects.toMatchObject({ statusCode: 429 });
    expect(repo.recordFailedLogin).not.toHaveBeenCalled();
  });

  it('gives the same error for unknown emails', async () => {
    repo.findCredentialsByEmail.mockResolvedValue(undefined);
    await expect(authService.login({ email: 'no@x.com', password: 'x' }, {})).rejects.toThrow(
      'Invalid email or password',
    );
  });

  it('rejects deactivated accounts and non-member tenants', async () => {
    await expect(
      authService.login({ email: 'u@x.com', password: 'Password123!', tenantSlug: 'other' }, {}),
    ).rejects.toMatchObject({ statusCode: 403 });
    user!.is_active = false;
    await expect(
      authService.login({ email: 'u@x.com', password: 'Password123!' }, {}),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
