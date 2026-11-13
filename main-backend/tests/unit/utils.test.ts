import { describe, expect, it } from 'vitest';
import { parseDurationMs } from '../../src/shared/utils/duration';
import { generateToken, hashToken, safeEqual } from '../../src/shared/utils/crypto';
import { likeTerm } from '../../src/shared/utils/pagination';
import { slugify } from '../../src/shared/utils/slug';
import { listQuerySchema } from '../../src/shared/utils/pagination';

describe('parseDurationMs', () => {
  it.each([
    ['30s', 30_000],
    ['15m', 900_000],
    ['2h', 7_200_000],
    ['7d', 604_800_000],
  ])('%s', (input, ms) => expect(parseDurationMs(input)).toBe(ms));

  it('rejects malformed input', () => {
    expect(() => parseDurationMs('15')).toThrow();
    expect(() => parseDurationMs('1w')).toThrow();
  });
});

describe('crypto', () => {
  it('generates unique url-safe tokens', () => {
    const a = generateToken();
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });

  it('hashes deterministically per secret', () => {
    expect(hashToken('t', 's1')).toBe(hashToken('t', 's1'));
    expect(hashToken('t', 's1')).not.toBe(hashToken('t', 's2'));
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
  });
});

describe('slugify / likeTerm', () => {
  it('slugifies', () => expect(slugify('  Ácme Corp, Ltd.  ')).toBe('acme-corp-ltd'));
  it('escapes LIKE wildcards', () => expect(likeTerm('50%_off\\')).toBe('%50\\%\\_off\\\\%'));
});

describe('listQuerySchema', () => {
  const schema = listQuerySchema(['name', 'createdAt'], 'createdAt');

  it('applies defaults and coerces numbers', () => {
    expect(schema.parse({ page: '2' })).toEqual({
      page: 2,
      limit: 20,
      sort: 'createdAt',
      order: 'desc',
    });
  });

  it('rejects non-allow-listed sort fields and oversized limits', () => {
    expect(schema.safeParse({ sort: 'password_hash' }).success).toBe(false);
    expect(schema.safeParse({ limit: '1000' }).success).toBe(false);
  });
});
