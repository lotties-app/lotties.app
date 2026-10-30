import { describe, expect, it } from 'vitest';
import { sha1, uuidV5 } from './uuidV5';

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

describe('uuidV5', () => {
  it('hashes with SHA-1', () => {
    expect(hex(sha1(new Uint8Array()))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(hex(sha1(new TextEncoder().encode('abc')))).toBe(
      'a9993e364706816aba3e25717850c26c9cd0d89d',
    );
    // 56 bytes: the padding spills into a second block.
    expect(
      hex(
        sha1(new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')),
      ),
    ).toBe('84983e441c3bd26ebaae4aa1f95129e5e54670f1');
  });

  it('gives the RFC 4122 version 5 id (same algorithm as the API DeterministicGuid)', () => {
    expect(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });

  it('is stable and depends on the name', () => {
    const ns = '0b7e5d2a-3c41-5f86-9a1d-6e2f8c4b7a90';
    expect(uuidV5(ns, 'a')).toBe(uuidV5(ns, 'a'));
    expect(uuidV5(ns, 'a')).not.toBe(uuidV5(ns, 'b'));
    expect(uuidV5(ns, 'a')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
