import { describe, expect, it } from 'vitest';
import { parsePayload, resolveLang, toWirePayload, validatePayload } from './payload';
import {
  BABY_ID,
  DELIVERY_ID,
  dosePayload,
  napPayload,
  RX_ID,
  testPayload,
  TOKEN,
} from './pushTestKit';

const parse = (value: unknown) => parsePayload(JSON.stringify(value), 'en');

describe('push payload parsing', () => {
  it('accepts a dose payload with every field', () => {
    const result = parse(dosePayload({ names: { baby: 'Lia', medication: 'Syrup' }, snooze: 2 }));
    expect(result).toEqual({
      ok: true,
      payload: {
        id: DELIVERY_ID,
        kind: 'dose_due',
        babyId: BABY_ID,
        rxId: RX_ID,
        at: Date.UTC(2026, 9, 21, 21, 0),
        lang: 'en',
        token: TOKEN,
        names: { baby: 'Lia', medication: 'Syrup' },
        snooze: 2,
      },
    });
  });

  it('accepts nap and test payloads', () => {
    expect(parse(napPayload())).toMatchObject({ ok: true, payload: { kind: 'nap_window' } });
    expect(parse(testPayload())).toMatchObject({ ok: true, payload: { kind: 'test' } });
  });

  it('lower-cases ids and keeps the payload language', () => {
    const result = parse(dosePayload({ id: DELIVERY_ID.toUpperCase(), lang: 'pt-BR' }));
    expect(result).toMatchObject({ ok: true, payload: { id: DELIVERY_ID, lang: 'pt-BR' } });
  });

  it.each([
    ['empty text', ''],
    ['not JSON', '{"v":1,'],
    ['a JSON array', '[1,2]'],
    ['a JSON string', '"dose_due"'],
    ['null', 'null'],
  ])('falls back to generic for %s, in the device language', (_, text) => {
    expect(parsePayload(text, 'pt-BR')).toEqual({ ok: false, lang: 'pt-BR' });
  });

  it('falls back to generic for a missing message', () => {
    expect(parsePayload(null, 'en')).toEqual({ ok: false, lang: 'en' });
    expect(parsePayload(undefined, 'pt-BR')).toEqual({ ok: false, lang: 'pt-BR' });
  });

  it.each([
    ['an unknown version', { v: 2 }],
    ['a missing version', { v: undefined }],
    ['a version as string', { v: '1' }],
    ['an unknown kind', { kind: 'coparent_activity' }],
    ['an inherited kind', { kind: 'constructor' }],
    ['a proto kind', { kind: '__proto__' }],
    ['a kind that is not a string', { kind: 3 }],
    ['a bad delivery id', { id: 'not-a-guid' }],
    ['a bad baby id', { babyId: '../../evil' }],
    ['a missing prescription id', { rxId: undefined }],
    ['a URL as prescription id', { rxId: 'https://evil.example/' }],
    ['an instant without zone', { at: '2026-10-21T21:00:00' }],
    ['an impossible instant', { at: '2026-13-45T99:00:00Z' }],
    ['an instant as number', { at: 1761080400000 }],
  ])('rejects %s but keeps the payload language', (_, overrides) => {
    expect(parse(dosePayload({ ...overrides, lang: 'pt-BR' }))).toEqual({
      ok: false,
      lang: 'pt-BR',
    });
  });

  it('needs a baby for naps', () => {
    expect(parse(napPayload({ babyId: undefined })).ok).toBe(false);
  });

  it('maps unknown languages to en and Portuguese variants to pt-BR', () => {
    expect(parse(dosePayload({ lang: 'de' }))).toMatchObject({ payload: { lang: 'en' } });
    expect(parse(dosePayload({ lang: 42 }))).toMatchObject({ payload: { lang: 'en' } });
    expect(resolveLang('pt-PT')).toBe('pt-BR');
    expect(resolveLang('PT')).toBe('pt-BR');
    expect(resolveLang('en-GB')).toBe('en');
    expect(resolveLang(undefined)).toBe('en');
  });

  it('uses the device language when the payload has none', () => {
    expect(parsePayload(JSON.stringify({ v: 9 }), 'pt-BR')).toEqual({ ok: false, lang: 'pt-BR' });
  });

  it('drops a malformed token instead of failing', () => {
    for (const token of ['short', 'has spaces in it but long enough', 123, null]) {
      const result = parse(dosePayload({ token }));
      expect(result.ok && 'token' in result.payload).toBe(false);
    }
  });

  it('drops malformed names (generic text) instead of failing', () => {
    for (const names of [
      'Lia',
      [],
      null,
      { baby: '' },
      { baby: '   ' },
      { baby: 5 },
      { medication: 'x' },
    ]) {
      const result = parse(dosePayload({ names }));
      expect(result.ok).toBe(true);
      expect(result.ok && result.payload.names).toBeUndefined();
    }
  });

  it('cleans control characters and trims names to 40 characters', () => {
    const result = parse(
      dosePayload({
        names: { baby: '  Li\u0000a\n\tB  ', medication: 'x'.repeat(60), extra: 'y' },
      }),
    );
    expect(result.ok && result.payload.names).toEqual({
      baby: 'Li a B',
      medication: 'x'.repeat(40),
    });
  });

  it('accepts snooze numbers 1 to 3 only', () => {
    const snooze = (value: unknown) => {
      const result = parse(dosePayload({ snooze: value }));
      return result.ok ? result.payload.snooze : 'invalid';
    };
    expect([1, 2, 3].map(snooze)).toEqual([1, 2, 3]);
    expect([0, 4, 1.5, '1', true].map(snooze)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('ignores unknown fields, including a URL', () => {
    const result = parse(dosePayload({ url: 'https://evil.example/', extra: { a: 1 } }));
    expect(result.ok && Object.keys(result.payload)).not.toContain('url');
  });

  it('round-trips through the wire form stored as notification data', () => {
    const parsed = parse(dosePayload({ names: { baby: 'Lia' }, snooze: 1 }));
    if (!parsed.ok) throw new Error('expected a valid payload');
    const wire = toWirePayload(parsed.payload);
    expect(wire).toMatchObject({ v: 1, at: '2026-10-21T21:00:00.000Z' });
    expect(validatePayload(wire)).toEqual(parsed);
  });

  it('rejects non-object data on validation', () => {
    expect(validatePayload(undefined)).toEqual({ ok: false, lang: 'en' });
    expect(validatePayload('x')).toEqual({ ok: false, lang: 'en' });
  });
});
