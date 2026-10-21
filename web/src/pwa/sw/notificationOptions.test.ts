import { describe, expect, it } from 'vitest';
import { buildNotification, keyInstant, notificationTag } from './notificationOptions';
import { parsePayload, validatePayload, type PushPayload } from './payload';
import { dosePayload, napPayload, testPayload } from './pushTestKit';

const build = (value: Record<string, unknown>) =>
  buildNotification(parsePayload(JSON.stringify(value), 'en'), 'UTC');

const payloadOf = (value: Record<string, unknown>): PushPayload => {
  const parsed = validatePayload(value);
  if (!parsed.ok) throw new Error('expected a valid payload');
  return parsed.payload;
};

describe('push notification options', () => {
  it('formats key instants like the server (yyyyMMddHHmm UTC)', () => {
    expect(keyInstant(Date.parse('2026-10-21T18:00:00-03:00'))).toBe('202610212100');
  });

  it('uses the server base key as tag', () => {
    expect(notificationTag(payloadOf(dosePayload()))).toBe(
      'dose:16fd27068baf433b82eb8c7fada847da:202610212100',
    );
    expect(notificationTag(payloadOf(napPayload()))).toBe('nap:7c9e6679742540de944be07fc1f90ae7');
    expect(notificationTag(payloadOf(testPayload()))).toBe('test:0f8fad5bd9cb469fa16570867728950e');
  });

  it('keeps the same tag for a snooze re-send of the same slot', () => {
    const first = build(dosePayload());
    const resend = build(dosePayload({ id: '11111111-2222-4333-8444-555555555555', snooze: 1 }));
    expect(resend.options.tag).toBe(first.options.tag);
    expect(first.options.renotify).toBe(false);
    expect(resend.options.renotify).toBe(true);
  });

  it('builds a dose notification with Snooze and Open actions', () => {
    const { title, options } = build(dosePayload({ lang: 'pt-BR' }));
    expect(title).toBe('Lembrete de remédio');
    expect(options).toMatchObject({
      lang: 'pt-BR',
      dir: 'auto',
      icon: '/icon-192.png',
      badge: '/icon-monochrome-512.png',
      timestamp: Date.UTC(2026, 9, 21, 21, 0),
      actions: [
        { action: 'snooze', title: 'Adiar 30 min' },
        { action: 'open', title: 'Abrir' },
      ],
    });
    expect(options).not.toHaveProperty('requireInteraction');
    expect(options).not.toHaveProperty('silent');
    expect(options).not.toHaveProperty('image');
  });

  it('offers no snooze without a token, and no actions for naps and tests', () => {
    expect(build(dosePayload({ token: undefined })).options.actions).toBeUndefined();
    expect(build(napPayload()).options.actions).toBeUndefined();
    expect(build(testPayload()).options.actions).toBeUndefined();
  });

  it('stores the validated payload in wire form as data', () => {
    const { options } = build(dosePayload({ url: 'https://evil.example/' }));
    expect(options.data).toMatchObject({ v: 1, kind: 'dose_due', at: '2026-10-21T21:00:00.000Z' });
    expect(options.data).not.toHaveProperty('url');
  });

  it('shows invalid payloads as generic text without tag, actions or data', () => {
    const { title, options } = build({ v: 1, kind: 'mystery', lang: 'pt-BR' });
    expect(title).toBe('Lotties');
    expect(options.body).toBe('Abra o app para ver os detalhes.');
    expect(options.tag).toBeUndefined();
    expect(options.renotify).toBeUndefined();
    expect(options.actions).toBeUndefined();
    expect(options.data).toBeUndefined();
  });
});
