import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { hashPassword, passwordSchema, verifyPassword } from '../../src/shared/utils/password';
import { hasPermissions } from '../../src/modules/auth/auth.guard';
import { signAccessToken, verifyAccessToken } from '../../src/modules/auth/token.service';
import { PERMISSIONS, type Permission } from '../../src/shared/constants/permissions';

describe('password policy', () => {
  it.each(['short1A', 'alllowercase123', 'ALLUPPERCASE123', 'NoDigitsHereAtAll'])(
    'rejects %s',
    (pw) => expect(passwordSchema.safeParse(pw).success).toBe(false),
  );
  it('accepts a strong password', () =>
    expect(passwordSchema.safeParse('Str0ngPassword').success).toBe(true));
});

describe('argon2 hashing', () => {
  it('hashes with argon2id and verifies', async () => {
    const hash = await hashPassword('Str0ngPassword');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'Str0ngPassword')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});

describe('access tokens', () => {
  it('round-trips subject and tenant', () => {
    const payload = verifyAccessToken(signAccessToken('user-1', 'tenant-1'));
    expect(payload).toMatchObject({ sub: 'user-1', tid: 'tenant-1', typ: 'access' });
  });

  it('rejects tampered, foreign-secret and alg=none tokens', () => {
    const token = signAccessToken('user-1', null);
    expect(() => verifyAccessToken(token.slice(0, -2) + 'xx')).toThrow('Invalid or expired');
    const foreign = jwt.sign({ typ: 'access' }, 'x'.repeat(40), { subject: 'u' });
    expect(() => verifyAccessToken(foreign)).toThrow();
    const none = jwt.sign({ typ: 'access', sub: 'u' }, '', { algorithm: 'none' });
    expect(() => verifyAccessToken(none)).toThrow();
  });
});

describe('hasPermissions', () => {
  const granted = new Set<Permission>([PERMISSIONS.USERS_READ, PERMISSIONS.ROLES_READ]);
  it('requires every permission', () => {
    expect(hasPermissions(granted, [PERMISSIONS.USERS_READ])).toBe(true);
    expect(hasPermissions(granted, [PERMISSIONS.USERS_READ, PERMISSIONS.USERS_CREATE])).toBe(false);
    expect(hasPermissions(granted, [])).toBe(true);
  });
});
