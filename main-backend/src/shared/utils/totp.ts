import { createHmac, randomBytes } from 'node:crypto';
import { safeEqual } from './crypto';

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — the profile every authenticator app supports.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const generateTotpSecret = () => base32Encode(randomBytes(20));

export const currentStep = (nowMs = Date.now()) => Math.floor(nowMs / 1000 / STEP_SECONDS);

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = h[h.length - 1]! & 0xf;
  const bin = (h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return bin.toString().padStart(6, '0');
}

/** Returns the matching step (±1 for clock drift) newer than `afterStep`, or null. */
export function verifyTotp(secret: string, code: string, afterStep = -1, nowMs = Date.now()) {
  const now = currentStep(nowMs);
  for (const step of [now - 1, now, now + 1]) {
    if (step > afterStep && safeEqual(totpAt(secret, step), code)) return step;
  }
  return null;
}

export function otpauthUrl(issuer: string, account: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${q}`;
}
