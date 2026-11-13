import argon2 from 'argon2';
import { z } from 'zod';

// OWASP-recommended argon2id baseline.
const HASH_OPTIONS = {
  type: argon2.argon2id as 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/\d/, 'Password must contain a number');

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, HASH_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Precomputed so unknown-email logins spend the same time as wrong-password logins. */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('dummy-password-for-timing-0A');
  return dummyHash;
}
