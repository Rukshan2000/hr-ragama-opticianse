import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

/** URL-safe opaque token with 256 bits of entropy. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Tokens are stored only as keyed hashes; a DB leak alone cannot be replayed. */
export function hashToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Uniform numeric code (e.g. 6-digit OTP), zero-padded. */
export function generateNumericCode(digits = 6): string {
  return randomInt(0, 10 ** digits)
    .toString()
    .padStart(digits, '0');
}

/** 32-byte key derived from a secret, separated by purpose so one secret never doubles as another key. */
export function deriveKey(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, '', purpose, 32));
}

/** AES-256-GCM; output is iv.tag.ciphertext in base64url. */
export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(payload: string, key: Buffer): string {
  const [iv, tag, body] = payload.split('.').map((p) => Buffer.from(p, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', key, iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(body!), d.final()]).toString('utf8');
}
