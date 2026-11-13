import { describe, expect, it } from 'vitest';
import { parsePasskeyOrigins } from '../../src/config/app.config';

describe('parsePasskeyOrigins', () => {
  it('accepts matching origins and subdomains', () => {
    expect(
      parsePasskeyOrigins('https://example.com, https://app.example.com', 'example.com', true),
    ).toEqual(['https://example.com', 'https://app.example.com']);
    expect(parsePasskeyOrigins('http://localhost:3000', 'localhost', false)).toEqual([
      'http://localhost:3000',
    ]);
  });

  it('rejects mismatched RP IDs, http in production and non-bare origins', () => {
    expect(() => parsePasskeyOrigins('https://evilexample.com', 'example.com', true)).toThrow(
      /suffix/,
    );
    expect(() => parsePasskeyOrigins('http://example.com', 'example.com', true)).toThrow(/https/);
    expect(() => parsePasskeyOrigins('https://example.com/path', 'example.com', true)).toThrow(
      /bare/,
    );
  });
});
