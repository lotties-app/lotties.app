import { describe, expect, it } from 'vitest';
import en from '../../i18n/locales/push.en.json';
import ptBR from '../../i18n/locales/push.pt-BR.json';
import { clickTarget } from './clickTarget';
import {
  deepLinkUrl,
  linkOfMessage,
  openMessageOf,
  parseDeepLinkHash,
  type NotificationLink,
} from './deepLink';
import { buildNotification, notificationTag } from './notificationOptions';
import { renderText } from './notificationText';
import { parsePayload, validatePayload } from './payload';
import { BABY_ID, DELIVERY_ID, TOKEN } from './pushTestKit';

/*
 * The cry monitor alert in the worker (docs/design/31-cry-detector-spike.md section 8,
 * docs/design/09-push-notifications.md section 2.12): codes and the start time only, generic text
 * from the bundled catalogs, one notification per baby that a new spell replaces and re-alerts,
 * Now as the click target.
 */

const SAO_PAULO = 'America/Sao_Paulo';

/** A spell that started at 14:32 São Paulo (17:32 UTC). */
const cryPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  id: DELIVERY_ID,
  kind: 'cry_detected',
  babyId: BABY_ID,
  at: '2026-10-21T17:32:00Z',
  lang: 'en',
  token: TOKEN,
  ...overrides,
});

const parse = (value: Record<string, unknown>) => parsePayload(JSON.stringify(value), 'en');

describe('the cry_detected payload', () => {
  it('accepts the codes-only payload and needs a baby', () => {
    expect(parse(cryPayload())).toEqual({
      ok: true,
      payload: {
        id: DELIVERY_ID,
        kind: 'cry_detected',
        babyId: BABY_ID,
        at: Date.UTC(2026, 9, 21, 17, 32),
        lang: 'en',
        token: TOKEN,
      },
    });
    expect(parse(cryPayload({ babyId: undefined })).ok).toBe(false);
  });

  it('ignores fields it does not know (no sound, score or detail is ever read)', () => {
    const parsed = parse(cryPayload({ score: 0.97, audio: 'x', eventId: BABY_ID }));
    expect(parsed.ok && Object.keys(parsed.payload).sort()).toEqual([
      'at',
      'babyId',
      'id',
      'kind',
      'lang',
      'token',
    ]);
  });

  it('is tagged per baby so a new spell replaces the alert, re-alerts, and never insists', () => {
    const shown = buildNotification(parse(cryPayload()), SAO_PAULO);
    const parsed = validatePayload(cryPayload());
    if (!parsed.ok) throw new Error('expected a valid payload');
    const tag = 'cry:7c9e6679742540de944be07fc1f90ae7';
    expect(notificationTag(parsed.payload)).toBe(tag);
    expect(shown.options.tag).toBe(tag);
    expect(shown.options.renotify).toBe(true);
    expect(shown.options.requireInteraction).toBeUndefined();
    expect(shown.options.actions).toBeUndefined();
    expect(shown.options.timestamp).toBe(Date.UTC(2026, 9, 21, 17, 32));
    expect(validatePayload(shown.options.data)).toEqual(parsed);
  });

  it('opens Now for the baby on click and round-trips the deep link', () => {
    const link: NotificationLink = { kind: 'cry', babyId: BABY_ID, deliveryId: DELIVERY_ID };
    for (const action of ['', 'open', 'snooze']) {
      expect(clickTarget(cryPayload(), action)).toEqual({
        type: 'open',
        path: `/#notify=cry&baby=${BABY_ID}&d=${DELIVERY_ID}`,
        message: {
          type: 'notification-open',
          kind: 'cry_detected',
          babyId: BABY_ID,
          deliveryId: DELIVERY_ID,
        },
      });
    }
    expect(parseDeepLinkHash(deepLinkUrl(link).slice(1))).toEqual(link);
    expect(linkOfMessage(openMessageOf(link))).toEqual(link);
  });
});

describe('cry_detected text', () => {
  it('says only that the monitor heard crying, and when, in English and Portuguese', () => {
    expect(renderText(parse(cryPayload()), SAO_PAULO)).toEqual({
      title: 'Crying detected',
      body: expect.stringMatching(/^The monitor heard crying at 02:32\sPM\. Open Lotties\.$/),
    });
    expect(renderText(parse(cryPayload({ lang: 'pt-BR' })), SAO_PAULO)).toEqual({
      title: 'Choro detectado',
      body: 'O monitor ouviu choro às 14:32. Abra o Lotties.',
    });
  });

  it('names the baby only when the payload carries names (show names on)', () => {
    expect(
      renderText(parse(cryPayload({ lang: 'pt-BR', names: { baby: 'Lia' } })), SAO_PAULO).body,
    ).toBe('Lia: o monitor ouviu choro às 14:32. Abra o Lotties.');
  });

  it('has the same keys in both worker catalogs and no alarming wording', () => {
    expect(Object.keys(ptBR.cry_detected).sort()).toEqual(Object.keys(en.cry_detected).sort());
    for (const lang of ['en', 'pt-BR']) {
      const { title, body } = renderText(parse(cryPayload({ lang })), SAO_PAULO);
      expect(`${title} ${body}`).not.toMatch(/colic|cólica|doctor|médic|urgent|urgente|!/i);
    }
  });
});
