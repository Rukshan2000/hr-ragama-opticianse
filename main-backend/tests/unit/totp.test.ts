import { describe, expect, it } from 'vitest';
import { decrypt, deriveKey, encrypt } from '../../src/shared/utils/crypto';
import { base32Decode, base32Encode, totpAt, verifyTotp } from '../../src/shared/utils/totp';

// RFC 6238 Appendix B test secret ("12345678901234567890"), SHA-1 vectors truncated to 6 digits.
const SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('matches RFC 6238 vectors', () => {
    expect(totpAt(SECRET, Math.floor(59 / 30))).toBe('287082');
    expect(totpAt(SECRET, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpAt(SECRET, Math.floor(2000000000 / 30))).toBe('279037');
  });

  it('accepts ±1 step, rejects replays and wrong codes', () => {
    const now = 1111111109_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(SECRET, totpAt(SECRET, step - 1), -1, now)).toBe(step - 1);
    expect(verifyTotp(SECRET, totpAt(SECRET, step), step, now)).toBeNull();
    expect(verifyTotp(SECRET, totpAt(SECRET, step - 2), -1, now)).toBeNull();
    expect(verifyTotp(SECRET, '000000', -1, now)).toBeNull();
  });

  it('round-trips base32 and AES-GCM', () => {
    expect(base32Decode(SECRET).toString()).toBe('12345678901234567890');
    const key = deriveKey('x'.repeat(32), 'test');
    const enc = encrypt(SECRET, key);
    expect(decrypt(enc, key)).toBe(SECRET);
    expect(() => decrypt(enc, deriveKey('y'.repeat(32), 'test'))).toThrow();
  });
});
